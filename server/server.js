const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const connectDB = require('./config/db');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST", "PATCH"] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('io', io);

// Routes
const rideRoutes = require('./routes/rides');
const authRoutes = require('./routes/authRoute');
const messageRoutes = require('./routes/messages');

app.use('/api/rides', rideRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

connectDB();

// Socket Logic
let onlineDrivers = [];

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('driver-online', (data) => {
    const existing = onlineDrivers.find(d => d.socketId === socket.id);
    if (!existing) onlineDrivers.push({ socketId: socket.id, lat: data.lat, lng: data.lng, rideId: null });
    broadcastStats();
  });

  socket.on('driver-location', (data) => {
    const driver = onlineDrivers.find(d => d.socketId === socket.id);
    if (driver) { driver.lat = data.lat; driver.lng = data.lng; driver.rideId = data.rideId; }
    socket.broadcast.emit('driver-location', { lat: data.lat, lng: data.lng });
  });

  socket.on('driver-arrived', (data) => socket.broadcast.emit('driver-arrived', { rideId: data.rideId }));
  
  socket.on('driver-offline', () => {
    onlineDrivers = onlineDrivers.filter(d => d.socketId !== socket.id);
    socket.broadcast.emit('driver-offline');
    broadcastStats();
  });

  // CHAT SYSTEM
  socket.on('send-message', async (data) => {
    try {
      const { rideId, senderId, senderName, message } = data;
      const newMsg = new Message({ rideId, senderId, senderName, message });
      await newMsg.save();
      io.to(`ride-${rideId}`).emit('new-message', newMsg);
    } catch (err) {
      console.error('Chat error:', err.message);
    }
  });

  socket.on('join-ride-room', (rideId) => {
    socket.join(`ride-${rideId}`);
  });

  socket.on('disconnect', () => {
    onlineDrivers = onlineDrivers.filter(d => d.socketId !== socket.id);
    broadcastStats();
  });

  function broadcastStats() {
    const activeRides = onlineDrivers.filter(d => d.rideId !== null).length;
    io.emit('driver-stats', { onlineDrivers: onlineDrivers.length, activeRides });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));