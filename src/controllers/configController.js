// @desc    Get public configuration for the frontend
// @route   GET /api/config
// @access  Public
const getPublicConfig = (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const config = {
      supabaseUrl,
      supabaseAnonKey,
      cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
      cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
      cloudinaryUploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET,
      mapTilerApiKey: process.env.MAPTILER_AI_KEY,
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      // We NEVER send the Cloudinary API Secret or Gemini API Key to the frontend
    };

    res.json({
      status: 'success',
      data: config
    });
  } catch (error) {
    console.error('Config Fetch Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve configuration'
    });
  }
};

module.exports = {
  getPublicConfig
};
