const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const verifyCustomJwt = (token) => {
  if (!process.env.JWT_SECRET) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const verifySupabaseJwt = async (token) => {
  if (!supabase.auth || typeof supabase.auth.getUser !== 'function') return null;

  try {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) return null;

    return {
      id: user.id,
      email: user.email,
      provider: 'supabase',
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata
    };
  } catch (error) {
    return null;
  }
};

const verifyAccessToken = async (token) => {
  const customUser = verifyCustomJwt(token);
  if (customUser) return customUser;

  const supabaseUser = await verifySupabaseJwt(token);
  if (supabaseUser) return supabaseUser;

  return null;
};

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;

  if (!token) {
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
    console.error(error);
    return res.status(401).json({
      status: 'error',
      message: 'Not authorized, token failed'
    });
  }
};

module.exports = { protect, verifyAccessToken };
