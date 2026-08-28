const express = require('express');

const {
  getAgent,
  getAgents,
} = require('../controllers/agent.controller');

const router = express.Router();

router.get('/', getAgents);
router.get('/:id', getAgent);

module.exports = router;
