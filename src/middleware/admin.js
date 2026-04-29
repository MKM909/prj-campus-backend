const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const getCurrentUser = async (userId) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, display_name, role')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return user;
};

const requireAdmin = async (req, res, next) => {
  try {
    const user = await getCurrentUser(req.user.id);

    // TEMPORARY BYPASS FOR TESTING
    // if (!user || user.role !== 'admin') {
    //   return res.status(403).json({
    //     status: 'error',
    //     message: 'Admin access required'
    //   });
    // }

    req.currentUser = user;
    return next();
  } catch (error) {
    console.error('Admin Check Error:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Could not verify admin access'
    });
  }
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
  protectEventStream
};
