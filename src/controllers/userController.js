const { validationResult } = require('express-validator');
const supabase = require('../config/supabase');

// @desc    Update user profile
// @route   PUT /api/users/edit
// @access  Private
const editUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { display_name } = req.body;
  const userId = req.user.id; // From protect middleware

  try {
    // Update user display name in Supabase
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({ display_name })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        display_name: updatedUser.display_name,
        role: updatedUser.role,
        reliability_score: updatedUser.reliability_score,
        rank: updatedUser.rank
      }
    });

  } catch (error) {
    console.error('Update Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Server error during profile update'
    });
  }
};

module.exports = {
  editUser
};
