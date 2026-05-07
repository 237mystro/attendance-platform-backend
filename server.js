// backend/server.js (add Socket.IO integration)
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./config/db');
const errorHandler = require('./middleware/error');
const { initializeSocket } = require('./socket');
const { startShiftNotifier } = require('./utils/shiftNotifier');
const http = require('http');
const path = require('path');

// Load env vars
dotenv.config({ path: './.env' });

// Connect to database
connectDB();

// Route files
const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const messageRoutes = require('./routes/messageRoutes');

const app = express();

// Create HTTP server
const server = http.createServer(app);

// Allowed CORS origins: local dev + any deployed frontend URL(s) from env
const allowedOrigins = [
  'https://autopay-mu.vercel.app',
  process.env.FRONTEND_URL,
  process.env.REACT_APP_FRONTEND_URL
].filter(Boolean);

const corsOriginHandler = (origin, callback) => {
  // Allow requests with no origin (e.g. mobile apps, curl, Postman)
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`CORS: origin ${origin} not allowed`));
  }
};

// Initialize Socket.IO
const io = require('socket.io')(server, {
  cors: {
    origin: corsOriginHandler,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io available to routes
app.set('io', io);

// Body parser — raise limits for large announcement text and file metadata
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Enable CORS
app.use(cors({
  origin: corsOriginHandler,
  credentials: true
}));

// Set security headers
app.use(helmet());

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Serve static files — allow cross-origin loading (frontend is on a different port)
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Mount routers
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/employees', employeeRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/attendance', require('./routes/attendanceRoutes'));
app.use('/api/v1/payrolls', require('./routes/payrollRoutes'));
app.use('/api/v1/schedules', require('./routes/scheduleRoutes'));
app.use('/api/v1/payments', require('./routes/paymentRoutes'));
app.use('/api/v1/locations', require('./routes/locationRoutes'));
app.use('/api/v1/settings', require('./routes/settingsRoutes'));
app.use('/api/v1/leave', require('./routes/leaveRoutes'));
app.use('/api/v1/shift-transfers', require('./routes/shiftTransferRoutes'));
app.use('/api/v1/deductions',     require('./routes/deductionRoutes'));
app.use('/api/v1/branches',       require('./routes/branchRoutes'));

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Initialize Socket.IO
initializeSocket(io);

// Start 30-min shift notification scheduler
startShiftNotifier(io);

server.listen(
  PORT,
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`)
);

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});
