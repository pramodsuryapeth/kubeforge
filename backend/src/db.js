const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set — copy .env.example to .env and configure it');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log(`Connected to MongoDB (${mongoose.connection.name})`);

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message);
  });
}

module.exports = { connectDB };
