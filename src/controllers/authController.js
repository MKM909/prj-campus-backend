const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const generateToken = require('../utils/generateToken');

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { email, password, display_name } = req.body;

  try {
    // 1. Domain Check (.edu.ng) - already handled by express-validator but extra check here
    if (!email.endsWith('.edu.ng')) {
      return res.status(400).json({
        status: 'error',
        message: 'Please use your school email (.edu.ng)'
      });
    }

    // 2. Check if user already exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({
        status: 'error',
        message: 'User already exists'
      });
    }

    // 3. Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 4. Generate display name
    const displayName = display_name || email.split('@')[0];

    // 5. Create user profile in Supabase
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          email,
          password_hash: hashedPassword,
          display_name: displayName,
          role: 'student',
          reliability_score: 5.0,
          rank: 'Newcomer 🌱',
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // 6. Generate and send JWT
    res.status(201).json({
      status: 'success',
      data: {
        id: newUser.id,
        email: newUser.email,
        display_name: newUser.display_name,
        role: newUser.role,
        reliability_score: newUser.reliability_score,
        rank: newUser.rank,
        token: generateToken(newUser.id, newUser.email)
      }
    });

  } catch (error) {
    console.error('Registration Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Server error during registration'
    });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Find user by email
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user || (await bcrypt.compare(password, user.password_hash)) === false) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password'
      });
    }

    // 2. Return user data and token
    res.json({
      status: 'success',
      data: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        reliability_score: user.reliability_score,
        rank: user.rank,
        token: generateToken(user.id, user.email)
      }
    });

  } catch (error) {
    console.error('Login Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Server error during login'
    });
  }
};

// @desc    Authenticate with Google
// @route   POST /api/auth/google
// @access  Public
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleSignIn = async (req, res) => {
  const idToken = req.body.id_token || req.body.idToken;

  console.log('[Google Auth] Attempting sign-in...');

  if (!idToken) {
    console.error('[Google Auth] Missing ID Token in request body');
    return res.status(400).json({ status: 'error', message: 'Google ID Token is required' });
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    console.error('[Google Auth] Configuration Error: GOOGLE_CLIENT_ID is not set in environment variables');
    return res.status(500).json({ status: 'error', message: 'Server configuration error' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const email = payload['email'];
    const displayName = payload['name'] || email.split('@')[0];
    const avatarUrl = payload['picture'];

    console.log(`[Google Auth] Verified token for: ${email}`);

    // 2. Domain check (.edu.ng) — COMMENTED OUT FOR TESTING
    // TODO: Uncomment before production deployment
    // if (!email.endsWith('.edu.ng')) {
    //   return res.status(403).json({
    //     status: 'error',
    //     message: 'Access Denied: Only school emails (.edu.ng) are allowed.'
    //   });
    // }

    // 3. Check if user exists in custom users table
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      // 4. Create new user if they don't exist
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          email,
          display_name: displayName,
          avatar_url: avatarUrl,
          role: 'student',
          reliability_score: 5.0,
          rank: 'Newcomer 🌱',
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
        
      if (insertError) throw insertError;
      user = newUser;
    } else if (user.avatar_url !== avatarUrl) {
      // 4b. Update avatar if it changed
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: avatarUrl })
        .eq('id', user.id)
        .select()
        .single();
      
      if (!updateError) user = updatedUser;
    }

    // 5. Generate Custom JWT
    res.json({
      status: 'success',
      data: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role,
        reliability_score: user.reliability_score,
        rank: user.rank,
        token: generateToken(user.id, user.email)
      }
    });

  } catch (error) {
    console.error('Google Sign-In Error:', error.message);
    res.status(500).json({ status: 'error', message: 'Authentication failed: ' + error.message });
  }
};

module.exports = {
  registerUser,
  loginUser,
  googleSignIn
};
