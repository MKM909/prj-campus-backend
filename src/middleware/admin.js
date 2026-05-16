const supabase = require('../config/supabase');
const { verifyAccessToken } = require('./auth');
const { ADMIN_ROLES, SUPER_ADMIN_ROLES } = require('../services/adminIntelligenceService');

const getCurrentUser = async (userId) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return user;
};

const requireAdmin = async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.user.id);

    if (!user || !ADMIN_ROLES.includes(user.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Admin access required'
      });
    }

    req.currentUser = user;
    req.adminUser = user;
    return next();
  } catch (error) {
    console.error('Admin Check Error:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Could not verify admin access'
    });
  }
};

const requireSuperAdmin = async (req, res, next) => {
  const user = req.currentUser || req.adminUser;

  if (!user || !SUPER_ADMIN_ROLES.includes(user.role)) {
    return res.status(403).json({
      status: 'error',
      message: 'Super admin access required'
    });
  }

  return next();
};

const protectEventStream = async (req, res, next) => {
  const token = req.query.token;

  if (!token || typeof token !== 'string') {
    return res.status(401).json({
      status: 'error',
      message: 'Not authorized, no token'
    });
  }

  try {
    const decoded = await verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({
        status: 'error',
        message: 'Not authorized, token failed'
      });
    }

    req.user = decoded;
    return next();
  } catch (error) {
    console.error('Realtime Auth Error:', error.message);
    return res.status(401).json({
      status: 'error',
      message: 'Not authorized, token failed'
    });
  }
};

module.exports = {
  requireAdmin,
  requireSuperAdmin,
  protectEventStream
};
