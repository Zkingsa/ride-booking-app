const express = require('express');
const router = express.Router();
const Cashout = require('../models/Cashout');
const User = require('../models/User');

// POST /api/cashouts - Record a cash-out for a driver.
// Body: { driverId, amount, method }
router.post('/', async (req, res) => {
  try {
    const { driverId, amount, method } = req.body;
    const user = await User.findById(driverId);
    if (!user) return res.status(404).json({ error: 'Driver not found' });

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Cash-out amount must be greater than 0.' });
    }

    const cashout = new Cashout({
      driverId,
      amount: parseFloat(amt.toFixed(2)),
      method: method === 'voucher' ? 'voucher' : 'card'
    });
    await cashout.save();
    res.status(201).json(cashout);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cashouts?driverId=... - List a driver's cash-out history (newest first).
router.get('/', async (req, res) => {
  try {
    const { driverId } = req.query;
    if (!driverId) return res.json([]);
    const cashouts = await Cashout.find({ driverId }).sort({ createdAt: -1 });
    res.json(cashouts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
