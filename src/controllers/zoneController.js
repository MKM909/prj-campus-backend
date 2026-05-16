const supabase = require('../config/supabase');

// @desc    Get all zones
// @route   GET /api/zones
// @access  Public
const getZones = async (req, res) => {
  try {
    const { data: zones, error } = await supabase
      .from('zones')
      .select('id, slug, name, description, color, status, centroid_lat, centroid_lng')
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({
      status: 'success',
      results: zones.length,
      data: zones,
    });
  } catch (error) {
    console.error('Get Zones Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch zones',
    });
  }
};

// @desc    Get a single zone with full polygon
// @route   GET /api/zones/:zoneId
// @access  Public
const getZone = async (req, res) => {
  const { zoneId } = req.params;

  try {
    const { data: zone, error } = await supabase
      .from('zones')
      .select('*')
      .or(`id.eq.${zoneId},slug.eq.${zoneId}`)
      .single();

    if (error) throw error;

    res.json({
      status: 'success',
      data: zone,
    });
  } catch (error) {
    console.error('Get Zone Error:', error.message);
    res.status(404).json({
      status: 'error',
      message: 'Zone not found',
    });
  }
};

// @desc    Get buildings in a zone
// @route   GET /api/zones/:zoneId/buildings
// @access  Public
const getZoneBuildings = async (req, res) => {
  const { zoneId } = req.params;

  try {
    // Support both UUID and slug lookup
    const { data: buildings, error } = await supabase
      .from('buildings')
      .select('id, name, latitude, longitude, osm_id, zone_slug')
      .or(`zone_id.eq.${zoneId},zone_slug.eq.${zoneId}`)
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({
      status: 'success',
      results: buildings.length,
      data: buildings,
    });
  } catch (error) {
    console.error('Get Zone Buildings Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch buildings',
    });
  }
};

module.exports = {
  getZones,
  getZone,
  getZoneBuildings,
};
