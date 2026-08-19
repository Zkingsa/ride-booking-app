const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// A driver's registered vehicle determines which ride category (the same
// Bike/Mini/Standard/XL tiers riders pick from) they're dispatched requests
// for — see VEHICLE_CATEGORY_MAP in routes/authRoute.js for the mapping.
const vehicleSchema = new mongoose.Schema({
  make: { type: String, trim: true },          // e.g. "Toyota Corolla"
  registration: { type: String, trim: true },   // license plate
  color: { type: String, trim: true },
  type: { type: String, enum: ['motorcycle', 'hatchback', 'sedan', 'minibus'] },
  seats: { type: Number, min: 1 },
  category: { type: String, enum: ['bike', 'mini', 'standard', 'xl'] } // derived from type
}, { _id: false });

const userSchema = new mongoose.Schema({
  // We add 'username' back, but allow it to be auto-generated
  username: { type: String, unique: true, sparse: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['rider', 'driver'], default: 'rider' },
  vehicle: { type: vehicleSchema, default: undefined }, // present only for role: 'driver'
  payoutMethod: { type: String, enum: ['card', 'voucher'], default: 'card' }, // how the driver gets paid
  resetPasswordToken: { type: String, default: undefined },  // sha256 hash of the reset token (never the raw token)
  resetPasswordExpires: { type: Date, default: undefined },  // when the reset token stops being valid
  createdAt: { type: Date, default: Date.now }
});

// Mongoose 9 hook (no 'next' parameter)
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
  
  // Automatically generate a unique username if not provided
  if (!this.username) {
    this.username = this.email.split('@')[0] + '_' + Date.now();
  }
});

module.exports = mongoose.model('User', userSchema);