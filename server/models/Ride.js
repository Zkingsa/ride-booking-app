const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  pickup: {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 }
  },
  dropoff: {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 }
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'completed'],
    default: 'pending'
  },
  cost: { type: Number, default: 0 },

  // Ride tier the rider picked (Bike/Mini/Standard/Saver). 'saver' trades a
  // longer wait for a lower price by giving drivers who are mid-trip first
  // shot at accepting once they wrap up (see routes/rides.js).
  rideType: { type: String, enum: ['bike', 'mini', 'standard', 'saver'], default: 'standard' },
  seats: { type: Number, default: 4 },

  // ✅ NEW FIELDS FOR PRIVACY
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Ride', rideSchema);