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

// Shared, mutable driver-presence state (kept as a single object, not a bare
// array, so routes/rides.js can read the *current* list via req.app.get()
// even after connection/disconnection handlers reassign it below).
const driverState = { list: [] };
app.set('driverState', driverState);

// Fallback + bounds for the driver-adjustable dispatch radius (see 'driver-radius' below).
const DEFAULT_REQUEST_RADIUS_KM = 8;
const MIN_REQUEST_RADIUS_KM = 1;
const MAX_REQUEST_RADIUS_KM = 80;
function clampRadius(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return DEFAULT_REQUEST_RADIUS_KM;
  return Math.min(MAX_REQUEST_RADIUS_KM, Math.max(MIN_REQUEST_RADIUS_KM, n));
}
app.set('DEFAULT_REQUEST_RADIUS_KM', DEFAULT_REQUEST_RADIUS_KM);

// GET /api/drivers/online - lets the rider app show nearby online drivers on
// the map (and a live "X drivers online" indicator) while it looks for a match.
app.get('/api/drivers/online', (req, res) => {
  const drivers = driverState.list
    .filter(d => typeof d.lat === 'number' && typeof d.lng === 'number')
    .map(d => ({ lat: d.lat, lng: d.lng, vehicleCategory: d.vehicleCategory || null, busy: !!d.rideId }));
  res.json(drivers);
});

// Routes
const rideRoutes = require('./routes/rides');
const authRoutes = require('./routes/authRoute');
const messageRoutes = require('./routes/messages');
const cashoutRoutes = require('./routes/cashouts');

app.use('/api/rides', rideRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/cashouts', cashoutRoutes);

connectDB();

// Socket Logic

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('driver-online', (data) => {
    const radiusKm = clampRadius(data.radiusKm);
    const existing = driverState.list.find(d => d.socketId === socket.id);
    if (!existing) driverState.list.push({ socketId: socket.id, lat: data.lat, lng: data.lng, rideId: null, radiusKm, vehicleCategory: data.vehicleCategory || null });
    else { existing.lat = data.lat; existing.lng = data.lng; existing.radiusKm = radiusKm; existing.vehicleCategory = data.vehicleCategory || existing.vehicleCategory || null; }
    broadcastStats();
  });

  // Lets an online driver adjust how far (1-80km) ride requests can come from.
  socket.on('driver-radius', (data) => {
    const driver = driverState.list.find(d => d.socketId === socket.id);
    if (driver) driver.radiusKm = clampRadius(data.radiusKm);
  });

  // Idle GPS ping (driver is online but not on a trip). Only keeps the
  // dispatch-radius data fresh — unlike 'driver-location' below, it is never
  // rebroadcast to riders, since there's no active trip to show it on.
  socket.on('driver-position', (data) => {
    const driver = driverState.list.find(d => d.socketId === socket.id);
    if (driver) { driver.lat = data.lat; driver.lng = data.lng; }
  });

  socket.on('driver-location', (data) => {
    const driver = driverState.list.find(d => d.socketId === socket.id);
    if (driver) { driver.lat = data.lat; driver.lng = data.lng; driver.rideId = data.rideId; }
    // Forward rideId + the driver's own moving/stationary detection so the
    // rider can match the broadcast to their ride and show "moving" vs
    // "stationary" (see reportPosition in driver.js).
    socket.broadcast.emit('driver-location', {
      lat: data.lat, lng: data.lng, rideId: data.rideId,
      moving: typeof data.moving === 'boolean' ? data.moving : true
    });
  });

  socket.on('driver-arrived', (data) => socket.broadcast.emit('driver-arrived', { rideId: data.rideId }));
  
  socket.on('driver-offline', () => {
    driverState.list = driverState.list.filter(d => d.socketId !== socket.id);
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

  // IN-APP CALL (signaling only — relays ring/accept/decline/end between the
  // two people already in the ride's room; no audio is transported here).
  socket.on('call-request', (data) => {
    socket.to(`ride-${data.rideId}`).emit('incoming-call', { rideId: data.rideId, callerName: data.callerName });
  });
  socket.on('call-accept', (data) => {
    socket.to(`ride-${data.rideId}`).emit('call-accepted', { rideId: data.rideId });
  });
  socket.on('call-decline', (data) => {
    socket.to(`ride-${data.rideId}`).emit('call-declined', { rideId: data.rideId });
  });
  socket.on('call-end', (data) => {
    socket.to(`ride-${data.rideId}`).emit('call-ended', { rideId: data.rideId });
  });

  socket.on('disconnect', () => {
    driverState.list = driverState.list.filter(d => d.socketId !== socket.id);
    broadcastStats();
  });

  function broadcastStats() {
    const activeRides = driverState.list.filter(d => d.rideId !== null).length;
    io.emit('driver-stats', { onlineDrivers: driverState.list.length, activeRides });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));