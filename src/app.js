const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { securityMiddlewares } = require('./middleware/security');
const authRoutes = require('./routes/authRoutes');

const app = express();

// 1. Basic Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json()); // Body parser
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev')); // Logging
}

// 2. Custom Security Middlewares (Rate limiting, XSS)
securityMiddlewares(app);

// 3. Routes
const userRoutes = require('./routes/userRoutes');
const configRoutes = require('./routes/configRoutes');
const aiRoutes = require('./routes/aiRoutes');
const reportRoutes = require('./routes/reportRoutes');
const messageRoutes = require('./routes/messageRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/config', configRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/messages', messageRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Hello'});
});

// 4. 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: 'Resource not found'
  });
});

// 5. Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

module.exports = app;
