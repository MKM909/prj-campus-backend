const express = require('express');
const { getPublicConfig } = require('../controllers/configController');

const router = express.Router();

router.get('/', getPublicConfig);

module.exports = router;
