
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// ========================================
// App Configuration
// ========================================

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ========================================
// Environment Validation
// ========================================

if (process.env.NODE_ENV === 'production') {
  if (!process.env.ADMIN_UIDS) {
    throw new Error(
      'ADMIN_UIDS is required in production.'
    );
  }
}

// ========================================
// Content Security Policy
// ========================================

const firebaseScriptSources = [
  "'self'",
  'https://www.gstatic.com',
  'https://apis.google.com'
];

const firebaseConnectSources = [
  "'self'",
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firebaseinstallations.googleapis.com',
  'https://www.googleapis.com',
  'https://www.gstatic.com',
  'https://api.cloudinary.com'
];

// ========================================
// Security Middleware
// ========================================

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      scriptSrc: firebaseScriptSources,

      // Explicit script element policy
      scriptSrcElem: firebaseScriptSources,

      connectSrc: firebaseConnectSources,

      frameSrc: [
        "'self'",
        'https://*.firebaseapp.com'
      ],

      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https:'
      ],

      styleSrc: [
         "'self'",
      "'unsafe-inline'",
      'https://cdnjs.cloudflare.com'
      ],

      fontSrc: [
        "'self'",
        'data:',
        'https:'
      ],

      objectSrc: ["'none'"],

      baseUri: ["'self'"],

      formAction: ["'self'"],

      upgradeInsecureRequests:
        process.env.NODE_ENV === 'production'
          ? []
          : null
    }
  }
}));

// ========================================
// CORS
// ========================================

const allowedOrigins = (
  process.env.CORS_ORIGINS || ''
)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allow requests without Origin header
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },

  methods: [
    'GET',
    'POST',
    'PATCH',
    'PUT',
    'DELETE',
    'OPTIONS'
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization'
  ],

  credentials: false,

  maxAge: 600
}));

// ========================================
// Request Body Parser
// ========================================

app.use(express.json({
  limit: '1mb',
  strict: true,

  // Meta webhook signature verification
  verify(req, res, buffer) {
    req.rawBody = Buffer.from(buffer);
  }
}));

app.use(express.urlencoded({
  extended: false,
  limit: '16kb'
}));

// ========================================
// Request Logging
// ========================================

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
    );

    next();
  });
}

// ========================================
// Health Check
// ========================================

// ========================================
// Detailed Health Check
// ========================================

const { db } = require('./src/config/firebase');
const geminiService = require('./src/services/ai/gemini.service');

async function checkFirestore() {
  let timeout;

  try {
    const firestoreCheck = db
      .collection('_system')
      .doc('_health_check')
      .get();

    await Promise.race([
      firestoreCheck,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Firestore connection timeout'));
        }, 5000);

        if (typeof timeout.unref === 'function') {
          timeout.unref();
        }
      })
    ]);

    return {
      status: 'connected',
      success: true
    };

  } catch (error) {
    console.error('[HEALTH: FIRESTORE]', error.message);

    return {
      status: 'disconnected',
      success: false
    };

  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function checkGeminiConfiguration() {
  try {
    const keys = geminiService.getApiKeys();
    const models = geminiService.getModels();

    const configured = keys.length > 0 && models.length > 0;

    return {
      status: configured ? 'configured' : 'not_configured',
      success: configured,
      keyCount: keys.length,
      modelCount: models.length
    };

  } catch (error) {
    return {
      status: 'configuration_error',
      success: false,
      keyCount: 0,
      modelCount: 0
    };
  }
}

app.get('/health', async (req, res) => {
  const startedAt = Date.now();

  const [firestore, gemini] = await Promise.all([
    checkFirestore(),
    Promise.resolve(checkGeminiConfiguration())
  ]);

  const checks = {
    server: {
      status: 'running',
      success: true
    },

    firestore,

    gemini
  };

  const ready =
    firestore.success &&
    gemini.success;

  return res.status(200).json({
    success: true,

    service: 'Nishat Fashion Category Admin',

    status: ready ? 'healthy' : 'degraded',

    ready,

    checks,

    responseTime: Date.now() - startedAt,

    timestamp: new Date().toISOString()
  });
});

// ========================================
// API Routes
// ========================================
const authRoutes = require('./src/routes/auth.routes');
const taxonomyRoutes = require('./src/routes/taxonomy.routes');
const productRoutes = require('./src/routes/product.routes');
const productLotRoutes = require('./src/routes/product-lot.routes');
const purchaseLotRoutes = require('./src/routes/purchase-lot.routes');
const stockAllocationRoutes = require('./src/routes/stock-allocation.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const couponRoutes = require('./src/routes/coupon.routes');
const aiRoutes = require('./src/routes/ai.routes');
const cloudinaryRoutes = require('./src/routes/cloudinary.routes');
const facebookRoutes = require('./src/facebook/facebook.routes');
const facebookPostRoutes = require('./src/facebook/facebook.post.routes');



app.use('/api/auth', authRoutes);
app.use('/api/taxonomy', taxonomyRoutes);
app.use('/api/products', productRoutes);
app.use('/api/products', productLotRoutes);
app.use('/api/lots', purchaseLotRoutes);
app.use('/api/stock-allocations', stockAllocationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/cloudinary', cloudinaryRoutes);

app.use('/api/facebook/posts', facebookPostRoutes);
app.use('/api/facebook', facebookRoutes);
// ========================================
// API Not Found
// ========================================

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found.'
  });
});

// ========================================
// Static Frontend
// ========================================

app.use(express.static(PUBLIC_DIR, {
  index: false,

  maxAge:
    process.env.NODE_ENV === 'production'
      ? '1h'
      : 0
}));

// ========================================
// Admin HTML Shell
// ========================================

function sendAdminShell(req, res) {
  res
    .status(200)
    .type('html')
    .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#ffffff">
  <title>Nishat Fashion Admin</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/assets/js/app.js"></script>
</body>
</html>`);
}

// ========================================
// Admin Routes
// ========================================

app.get('/', sendAdminShell);
app.get('/login', sendAdminShell);

// ========================================
// Global 404 Handler
// ========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Page not found.'
  });
});

// ========================================
// Global Error Handler
// ========================================

app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', {
    message: err.message,
    path: req.originalUrl,
    method: req.method
  });

  if (res.headersSent) {
    return next(err);
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Request data is too large.'
    });
  }

  if (
    err instanceof SyntaxError &&
    err.status === 400
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON request.'
    });
  }

  const status = err.status || err.statusCode || 500;

  return res.status(status).json({
    success: false,

    message:
      process.env.NODE_ENV === 'production'
        ? 'Internal server error.'
        : err.message,

    ...(err.code ? { code: err.code } : {})
  });
});

// ========================================
// Start Server
// ========================================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('================================');
    console.log('Nishat Fashion Category Admin');
    console.log(`Server running on port ${PORT}`);
    console.log(
      `Environment: ${process.env.NODE_ENV || 'development'}`
    );
    console.log('================================');
  });
}

module.exports = app;
