const express = require('express');
const { getZones, getZone, getZoneBuildings } = require('../controllers/zoneController');

const router = express.Router();

// GET /api/zones — List all zones
router.get('/', getZones);

// GET /api/zones/:zoneId — Get single zone (by UUID or slug)
router.get('/:zoneId', getZone);

// GET /api/zones/:zoneId/buildings — Get buildings in a zone
router.get('/:zoneId/buildings', getZoneBuildings);

module.exports = router;
