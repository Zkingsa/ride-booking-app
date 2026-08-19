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

  // Human-readable addresses set by the rider at booking, so both the rider
  // and driver can see where they picked up / dropped off in history and on
  // the live ride (old rides fall back to coordinates).
  pickupAddress: { type: String, trim: true, default: '' },
  dropoffAddress: { type: String, trim: true, default: '' },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'arrived', 'in_progress', 'completed'],
    default: 'pending'
  },
  cost: { type: Number, default: 0 },

  // The 4-digit code the rider set when booking. The driver must enter this
  // (given to them by the passenger) to START the ride — prevents a driver
  // from starting a ride without the passenger on board to take card payment.
  confirmationCode: { type: String, trim: true, default: '' },

  // Waiting-fee timing. When the driver clicks "Arrived at pickup" we stamp
  // arrivedAt; the first 2 minutes are free, then R0.20 accrues every 20s
  // until the ride is started (startedAt), where waitingFee is frozen.
  arrivedAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  waitingFee: { type: Number, default: 0 },

  // Ride tier the rider picked (Bike/Mini/Standard/XL/Saver). Bike/Mini/
  // Standard/XL are matched to a driver whose registered vehicle is that
  // same category (see VEHICLE_CATEGORY_MAP in routes/authRoute.js); 'saver'
  // trades a longer wait for a lower price by giving drivers who are
  // mid-trip first shot at accepting once they wrap up, regardless of vehicle
  // category (see routes/rides.js).
  rideType: { type: String, enum: ['bike', 'mini', 'standard', 'xl', 'saver'], default: 'standard' },
  seats: { type: Number, default: 4 },
  paymentMethod: { type: String, enum: ['cash', 'card'], default: 'cash' },

  // ✅ NEW FIELDS FOR PRIVACY
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Ride', rideSchema);