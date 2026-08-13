const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // We add 'username' back, but allow it to be auto-generated
  username: { type: String, unique: true, sparse: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['rider', 'driver'], default: 'rider' },
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