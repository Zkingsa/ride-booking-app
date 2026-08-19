const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/mailer');

// Base URL used to build the password-reset link users click in their email.
// Override with FRONTEND_URL in production; defaults to the local dev server.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Auto-detects which ride category a driver's registered vehicle serves
// (Bike / Mini / Standard / XL) from the vehicle type, its model name, and
// the number of passenger seats. 'saver' is deliberately NOT a vehicle
// category — it's a fare/wait tier any category can serve (see rides.js).
const CATEGORY_LABEL = { bike: 'Bike', mini: 'Mini', standard: 'Standard', xl: 'XL' };
function classifyVehicle(type, make, seats) {
  const model = String(make || '').toLowerCase();
  const s = Number(seats) || 0;

  // Explicit model hints beat the generic rules — a "Honda CBR" or a
  // "Toyota Quantum" is caught even if the type dropdown was picked loosely.
  const bikeHints = ['motorcycle', 'motorbike', 'bike', 'scooter', 'bajaj', 'ktm', 'ninja', 'gsxr', 'cbr', 'husqvarna', 'duke', 'tvs', 'hero', 'pulsar', 'r1', 'r3'];
  const xlHints = ['minibus', 'mini bus', 'quantum', 'hiace', 'sprinter', 'venture', 'kombi', 'van', 'panel', 'econo', 'l300', 'l200', 'caravan', 'people carrier'];

  if (type === 'motorcycle' || bikeHints.some(k => model.includes(k))) return 'bike';
  if (xlHints.some(k => model.includes(k))) return 'xl';

  // The passenger count refines the generic type rules: a 5-seat hatchback is
  // closer to a Standard, and a 6+ seat minibus is an XL.
  if (type === 'minibus') return s >= 6 ? 'xl' : 'standard';
  if (type === 'hatchback') return s >= 5 ? 'standard' : 'mini';
  if (type === 'sedan') return s >= 6 ? 'xl' : 'standard';
  return 'standard';
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, vehicle } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'This email is already registered. Please login.' });
    }

    let vehicleData;
    if (role === 'driver') {
      if (!vehicle || !vehicle.make || !vehicle.registration || !vehicle.color || !vehicle.type || !vehicle.seats) {
        return res.status(400).json({ error: 'Please provide your vehicle name, registration, color, type, and passenger seats.' });
      }
      if (!['motorcycle', 'hatchback', 'sedan', 'minibus'].includes(vehicle.type)) {
        return res.status(400).json({ error: 'Please select a valid vehicle type.' });
      }
      // Category is auto-detected from the model name + seat count.
      const category = classifyVehicle(vehicle.type, vehicle.make, vehicle.seats);
      vehicleData = {
        make: vehicle.make, registration: vehicle.registration, color: vehicle.color,
        type: vehicle.type, seats: vehicle.seats, category
      };
    }

    // We intentionally do NOT send username here. The model will generate it.
    const user = new User({ name, email, password, role, vehicle: vehicleData });
    await user.save();

    return res.status(201).json({ 
      message: 'User created successfully! You can now login.',
      category: role === 'driver' ? vehicleData.category : undefined
    });

  } catch (err) {
    console.error('Registration error:', err.message);
    return res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role }, 
      'your_jwt_secret_key', 
      { expiresIn: '1d' }
    );

    return res.json({ 
      token, 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role,
        vehicle: user.vehicle || undefined,
        payoutMethod: user.payoutMethod || 'card'
      } 
    });

  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

// PATCH /api/auth/payout - Update a driver's payout method (card or voucher)
router.patch('/payout', async (req, res) => {
  try {
    const { userId, payoutMethod } = req.body;
    if (!userId) return res.status(400).json({ error: 'User id is required.' });
    if (!['card', 'voucher'].includes(payoutMethod)) {
      return res.status(400).json({ error: 'Payout method must be card or voucher.' });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { payoutMethod },
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user._id, payoutMethod: user.payoutMethod });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password - Request a password reset link (by email)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Please provide your email address.' });

    const user = await User.findOne({ email });
    // Respond identically whether or not the account exists, so this endpoint
    // can't be used to probe which emails are registered.
    const generic = { message: 'If that email is registered, a password reset link has been sent.' };

    if (!user) return res.json(generic);

    // 32 random bytes -> hex token. Only the sha256 hash is stored, so a
    // database leak can't be used to reset accounts.
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
    user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    const resetLink = `${FRONTEND_URL}/reset-password.html?token=${token}`;
    const emailSent = await sendPasswordResetEmail(user.email, resetLink);

    // No SMTP configured (local dev): log the link and, outside production,
    // return it so the flow is still testable end-to-end.
    if (!emailSent) {
      console.log(`[forgot-password] Reset link for ${user.email}: ${resetLink}`);
      if (process.env.NODE_ENV !== 'production') {
        return res.json({ ...generic, devResetLink: resetLink });
      }
    }
    return res.json(generic);
  } catch (err) {
    console.error('Forgot-password error:', err.message);
    return res.status(500).json({ error: 'Server error during password reset request' });
  }
});

// POST /api/auth/reset-password - Set a new password with a valid token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required.' });
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hash,
      resetPasswordExpires: { $gt: new Date() }
    });
    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    user.password = password; // re-hashed by the model's pre-save hook
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({ message: 'Password updated! You can now login with your new password.' });
  } catch (err) {
    console.error('Reset-password error:', err.message);
    return res.status(500).json({ error: 'Server error during password reset' });
  }
});

// GET /api/auth/user/:id - basic public profile lookup, used to show the
// counterpart's name + vehicle once a ride is accepted (rider sees driver, driver sees rider)
router.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('name role vehicle');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user._id, name: user.name, role: user.role, vehicle: user.vehicle || undefined });
  } catch (err) {
    res.status(400).json({ error: 'Invalid user id' });
  }
});

module.exports = router;