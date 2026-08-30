const express = require('express');

const { executeTask } = require('../controllers/task.controller');

const router = express.Router();

router.post('/execute', executeTask);

module.exports = router;
