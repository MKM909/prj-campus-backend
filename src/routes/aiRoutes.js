const express = require('express');
const { analyzeReport, queryChat } = require('../controllers/aiController');

const router = express.Router();

router.post('/analyze', analyzeReport);
router.post('/chat', queryChat);

module.exports = router;
