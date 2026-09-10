const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const seedData = require('./utils/seed');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// Load environment variables
dotenv.config();

const app = express();

// CORS configuration for frontend integration
app.use(
  cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  })
);

// Express Body Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({ status: 'UP', message: 'Physiotherapy Backend API is running smoothly.' });
});

// API Routes Mount
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/exercises', require('./routes/exerciseRoutes'));
app.use('/api', require('./routes/patientRoutes'));
app.use('/api/therapist', require('./routes/therapistRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// Centralized Error Handling Middlewares
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Initialize Database Connection, Auto-Seed, and Start Express Server
const startServer = async () => {
  await connectDB();
  await seedData(false);
  app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
};

startServer();
