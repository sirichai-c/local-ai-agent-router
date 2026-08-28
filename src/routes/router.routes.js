const express = require('express');

const { analyzeTask, planTask } = require('../controllers/router.controller');

const router = express.Router();

router.post('/analyze', analyzeTask);
router.post('/plan', planTask);

module.exports = router;
