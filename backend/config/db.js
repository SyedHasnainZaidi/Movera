const mongoose = require('mongoose');

let mongodInstance = null;

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/physiodb';
  
  try {
    // Attempt connecting to local/remote MongoDB instance
    const conn = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2500 });
    console.log(`MongoDB Connected (Native): ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.log(`Native MongoDB connection unavailable. Initializing Embedded MongoDB Server (v5.0.14)...`);
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      mongodInstance = await MongoMemoryServer.create({
        binary: {
          version: '5.0.14',
        },
      });
      const uri = mongodInstance.getUri();
      
      const conn = await mongoose.connect(uri);
      console.log(`MongoDB Connected (Embedded Server): ${uri}`);
      return conn;
    } catch (fallbackError) {
      console.error(`Failed to connect to MongoDB: ${fallbackError.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
