require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas');

  const collection = mongoose.connection.collection('users');
  const indexes = await collection.indexes();
  console.log('Current indexes:', indexes.map(i => i.name));

  const hasUsernameIndex = indexes.some(i => i.name === 'username_1');
  if (!hasUsernameIndex) {
    console.log('No username_1 index found — nothing to drop.');
  } else {
    await collection.dropIndex('username_1');
    console.log('Dropped index: username_1');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
