const express = require('express');

const {
  getAgentCategoryPerformance,
  getAgentPerformance,
} = require('../controllers/performance.controller');

const router = express.Router();

router.get('/agents/:id/categories/:category', getAgentCategoryPerformance);
router.get('/agents/:id', getAgentPerformance);

module.exports = router;
