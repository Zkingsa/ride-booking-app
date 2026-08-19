const express = require('express');
const router = express.Router();
const Ride = require('../models/Ride');

// How long idle drivers wait behind busy ones before a Saver ride is opened
// up to everyone. Keeps the "cheaper but slower" trade-off honest instead of
// just being a label with no real effect.
const SAVER_IDLE_DELAY_MS = 45000;

// Waiting-fee model: the first 2 minutes after the driver clicks "Arrived at
// pickup" are free; after that R0.20 accrues every 20 seconds until the ride
// starts. The server is the source of truth; clients mirror these values for
// the live countdown display.
const FREE_WAIT_MS = 2 * 60 * 1000;   // 2 minutes free
const WAIT_FEE_PERIOD_MS = 20 * 1000; // 20 seconds per charge
const WAIT_FEE_PER_PERIOD = 0.20;     // R0.20 per period

function computeWaitingFee(arrivedAt, startedAt) {
  if (!arrivedAt || !startedAt) return 0;
  const waitedMs = new Date(startedAt) - new Date(arrivedAt);
  if (waitedMs <= FREE_WAIT_MS) return 0;
  const chargedMs = waitedMs - FREE_WAIT_MS;
  const periods = Math.floor(chargedMs / WAIT_FEE_PERIOD_MS);
  return parseFloat((periods * WAIT_FEE_PER_PERIOD).toFixed(2));
}

// Used only for a driver entry that somehow has no radiusKm set yet.
const DEFAULT_REQUEST_RADIUS_KM = 8;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Notify only drivers who are (a) online, (b) within THEIR OWN chosen
// dispatch radius of the pickup point (each driver sets this themselves,
// 1-80km — see 'driver-radius' in server.js), and (c) driving the category
// of vehicle the ride actually asked for (Bike/Mini/Standard/XL — a sedan
// driver shouldn't be pinged for a motorcycle request, and vice versa).
// 'saver' isn't a vehicle type — any category can serve it. Drivers with no
// known position/vehicle yet are still included on those specific checks
// (better to notify than to silently skip for a reason they can't see) — but
// a driver who's genuinely out of radius or driving the wrong car is
// correctly left out, never overridden.
function findEligibleDrivers(allDrivers, pickup, rideType) {
  return allDrivers.filter(d => {
    // A driver already on a trip isn't offered new requests (they resume
    // looking once they finish and pull 200m+ away from the dropoff). 'saver'
    // is the exception — it intentionally targets busy drivers who are about
    // to finish, so they get those requests first.
    if (rideType !== 'saver' && d.rideId) return false;
    if (rideType !== 'saver' && d.vehicleCategory && d.vehicleCategory !== rideType) return false;
    if (typeof d.lat !== 'number' || typeof d.lng !== 'number') return true;
    const radius = d.radiusKm || DEFAULT_REQUEST_RADIUS_KM;
    return haversineKm(d.lat, d.lng, pickup.lat, pickup.lng) <= radius;
  });
}

// POST /api/rides - Create a new ride (Rider)
router.post('/', async (req, res) => {
  try {
    const { pickup, dropoff, cost, riderId, rideType, seats, paymentMethod, confirmationCode, pickupAddress, dropoffAddress } = req.body;

    // The rider sets a 4-digit confirmation code at booking; the driver must
    // present it to start the ride (anti-fraud for card payment).
    const code = String(confirmationCode || '').trim();
    if (!/^\d{4}$/.test(code)) {
      return res.status(400).json({ error: 'Please set a 4-digit confirmation code.' });
    }

    const ride = new Ride({ pickup, dropoff, cost, riderId, rideType, seats, paymentMethod, confirmationCode: code, pickupAddress: String(pickupAddress || '').trim(), dropoffAddress: String(dropoffAddress || '').trim() });
    await ride.save();

    const io = req.app.get('io');
    const driverState = req.app.get('driverState');
    const allDrivers = (driverState && driverState.list) || [];
    const eligible = findEligibleDrivers(allDrivers, pickup, ride.rideType);

    if (rideType === 'saver' && eligible.length > 0) {
      // Saver rides are matched with a driver who is already out on a trip and
      // about to finish, so those drivers get the request first...
      const busySockets = eligible.filter(d => d.rideId).map(d => d.socketId);
      busySockets.forEach(socketId => io.to(socketId).emit('new-ride', ride));

      // ...and everyone else (still within their own radius, re-checked live)
      // only sees it after a delay, unless it's still pending by then.
      setTimeout(async () => {
        try {
          const stillPending = await Ride.findById(ride._id);
          if (!stillPending || stillPending.status !== 'pending') return;
          const freshDrivers = (driverState && driverState.list) || [];
          const freshEligible = findEligibleDrivers(freshDrivers, pickup, ride.rideType);
          freshEligible.forEach(d => io.to(d.socketId).emit('new-ride', stillPending));
        } catch (e) { /* ride may have been removed/updated; ignore */ }
      }, SAVER_IDLE_DELAY_MS);
    } else {
      eligible.forEach(d => io.to(d.socketId).emit('new-ride', ride));
    }

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

// PATCH /api/rides/:id - Update ride status (Accept / Arrived / Start / Complete)
router.patch('/:id', async (req, res) => {
  try {
    const { status, driverId } = req.body;
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });

    let updateData = { status };

    // A driver accepting assigns them to the ride.
    if (status === 'accepted' && driverId) {
      updateData.driverId = driverId;
    } else if (status === 'arrived') {
      // Driver clicked "Arrived at pickup" — starts the free 2-min wait window.
      if (String(ride.driverId) !== String(driverId)) return res.status(403).json({ error: 'Not your ride' });
      updateData.arrivedAt = new Date();
    } else if (status === 'in_progress') {
      // Driver wants to START the ride. They must present the passenger's
      // confirmation code, otherwise (card payment) they could claim a ride
      // nobody is on. Freeze the waiting fee at this moment.
      if (String(ride.driverId) !== String(driverId)) return res.status(403).json({ error: 'Not your ride' });
      const code = String(req.body.confirmationCode || '').trim();
      if (ride.confirmationCode && code !== ride.confirmationCode) {
        return res.status(400).json({ error: 'Invalid confirmation code. Ask the passenger for the code they set.' });
      }
      updateData.startedAt = new Date();
      updateData.waitingFee = computeWaitingFee(ride.arrivedAt, new Date());
    }

    const updated = await Ride.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    const io = req.app.get('io');
    io.emit('ride-updated', updated);

    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;