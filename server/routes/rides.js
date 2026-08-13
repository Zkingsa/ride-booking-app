const express = require('express');
const router = express.Router();
const Ride = require('../models/Ride');

// POST /api/rides - Create a new ride
router.post('/', async (req, res) => {
  try {
    const ride = new Ride(req.body);
    await ride.save();
    
    // 📡 Emit real-time event to all connected drivers
    const io = req.app.get('io');
    io.emit('new-ride', ride);
    
    res.status(201).json(ride);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/rides - Get all rides
router.get('/', async (req, res) => {
  try {
    const rides = await Ride.find().sort({ createdAt: -1 });
    res.json(rides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/rides/:id - Update ride status
router.patch('/:id', async (req, res) => {
  try {
    const ride = await Ride.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true }
    );
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    
    // 📡 Emit update event
    const io = req.app.get('io');
    io.emit('ride-updated', ride);
    
    res.json(ride);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;