const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { securityMiddlewares } = require('./middleware/security');
const authRoutes = require('./routes/authRoutes');
const supabase = require('./config/supabase');

const app = express();

// Allowed origins: Vite dev server + optional production URL from env
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : [])
];

// 1. Basic Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, mobile) and allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json()); // Body parser
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev')); // Logging
}

// 1.5 Health check (placed before security middlewares to avoid rate limiting)
let lastDbCheck = 0;
let dbStatusCache = null;
const DB_CACHE_TTL = 30000; // 30 seconds

app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'UP',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: 'checking...',
    system: {
      node_version: process.version,
      memory_usage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      platform: process.platform
    }
  };

  const now = Date.now();
  if (dbStatusCache && (now - lastDbCheck < DB_CACHE_TTL)) {
    healthStatus.database = dbStatusCache.status;
    if (dbStatusCache.error) healthStatus.db_error = dbStatusCache.error;
    healthStatus.cache = true;
  } else {
    try {
      const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).limit(1);
      if (error) {
        dbStatusCache = { status: 'DEGRADED', error: error.message };
      } else {
        dbStatusCache = { status: 'CONNECTED', error: null };
      }
    } catch (err) {
      dbStatusCache = { status: 'ERROR', error: err.message };
    }
    lastDbCheck = now;
    healthStatus.database = dbStatusCache.status;
    if (dbStatusCache.error) healthStatus.db_error = dbStatusCache.error;
    healthStatus.cache = false;
  }

  res.json(healthStatus);
});

// 2. Custom Security Middlewares (Rate limiting, XSS)
securityMiddlewares(app);

// 3. Routes
const userRoutes = require('./routes/userRoutes');
const configRoutes = require('./routes/configRoutes');
const aiRoutes = require('./routes/aiRoutes');
const reportRoutes = require('./routes/reportRoutes');
const messageRoutes = require('./routes/messageRoutes');
const adminRoutes = require('./routes/adminRoutes');
const announcementRoutes = require('./routes/announcementRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/config', configRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/announcements', announcementRoutes);


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
