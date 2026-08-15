const express = require('express');
const router = express.Router();
const Ride = require('../models/Ride');

// POST /api/rides - Create a new ride (Rider)
router.post('/', async (req, res) => {
  try {
    const { pickup, dropoff, cost, riderId } = req.body;
    const ride = new Ride({ pickup, dropoff, cost, riderId });
    await ride.save();
    
    const io = req.app.get('io');
    io.emit('new-ride', ride);
    
    res.status(201).json(ride);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/rides - Get rides (Filtered by role!)
router.get('/', async (req, res) => {
  try {
    const { riderId, driverId, role } = req.query;

    let query = {};

    // 👑 RIDER LOGIC: Only show their own rides + pending ones
    if (role === 'rider' && riderId) {
      query = { 
        $or: [
          { riderId: riderId }, 
          { status: 'pending' } // Riders can see pending rides globally
        ]
      };
    } 
    // 🚗 DRIVER LOGIC: Show pending rides (to accept) + their own history
    else if (role === 'driver' && driverId) {
      query = { 
        $or: [
          { status: 'pending' },           // Available to accept
          { driverId: driverId }           // Their own history
        ]
      };
    } 
    // 📦 FALLBACK: If no ID passed, show nothing (security)
    else {
      return res.json([]);
    }

    const rides = await Ride.find(query).sort({ createdAt: -1 });
    res.json(rides);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/rides/:id - Update ride status (Accept/Complete)
router.patch('/:id', async (req, res) => {
  try {
    const { status, driverId } = req.body;
    
    let updateData = { status };
    // If a driver is accepting, assign them to the ride
    if (status === 'accepted' && driverId) {
      updateData.driverId = driverId;
    }

    const ride = await Ride.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    
    const io = req.app.get('io');
    io.emit('ride-updated', ride);
    
    res.json(ride);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;