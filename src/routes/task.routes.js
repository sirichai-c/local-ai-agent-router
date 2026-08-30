const express = require('express');

const {
  competeTask,
  executeTask,
} = require('../controllers/task.controller');

const router = express.Router();

router.post('/execute', executeTask);
router.post('/compete', competeTask);

module.exports = router;
