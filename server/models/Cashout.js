const mongoose = require('mongoose');

// A driver cash-out: the driver moves their available earnings to their
// chosen payout method (card or voucher). Each cash-out is recorded so the
// driver can see a history of how much they've withdrawn, when, and how.
const cashoutSchema = new mongoose.Schema({
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ['card', 'voucher'], default: 'card' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Cashout', cashoutSchema);
