const express = require('express');
const { body } = require('express-validator');
const { registerUser, loginUser, googleSignIn } = require('../controllers/authController');
const { authLimiter } = require('../middleware/security');

const router = express.Router();

// Registration Validation
const registerValidation = [
  body('email')
    .isEmail()
    .withMessage('Enter a valid email')
    .normalizeEmail()
    .custom((value) => {
      if (!value.endsWith('.edu.ng')) {
        throw new Error('Please use your school email (.edu.ng)');
      }
      return true;
    }),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .escape()
];

// Login Validation
const loginValidation = [
  body('email').isEmail().withMessage('Enter a valid email'),
  body('password').notEmpty().withMessage('Password is required')
];

router.post('/register', authLimiter, registerValidation, registerUser);
router.post('/login', authLimiter, loginValidation, loginUser);
router.post('/google', authLimiter, googleSignIn);

module.exports = router;
