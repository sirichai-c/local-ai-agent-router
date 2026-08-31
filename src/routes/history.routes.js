const express = require('express');

const {
  getTask,
  getTasks,
} = require('../controllers/history.controller');

const router = express.Router();

router.get('/tasks', getTasks);
router.get('/tasks/:id', getTask);

module.exports = router;
