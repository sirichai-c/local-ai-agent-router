const express = require('express');

const { analyzeTask } = require('../controllers/router.controller');

const router = express.Router();

router.post('/analyze', analyzeTask);

module.exports = router;
