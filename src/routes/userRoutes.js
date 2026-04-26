const express = require('express');
const { body } = require('express-validator');
const { editUser } = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { limiter } = require('../middleware/security');

const router = express.Router();

// Edit Profile Validation
const editValidation = [
  body('display_name')
    .notEmpty().withMessage('Display name is required')
    .isLength({ min: 2, max: 20 }).withMessage('Name must be between 2 and 20 characters')
    .escape()
];

// @route   PUT /api/users/edit
// @desc    Update user display name
// @access  Private (Needs JWT)
router.put('/edit', protect, limiter, editValidation, editUser);

module.exports = router;
