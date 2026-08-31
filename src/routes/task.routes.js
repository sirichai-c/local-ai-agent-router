const express = require('express');

const {
  approveTask,
  competeTask,
  executeTask,
  getCandidate,
  rejectTask,
} = require('../controllers/task.controller');

const router = express.Router();

router.post('/execute', executeTask);
router.post('/compete', competeTask);
router.get('/:id/candidate', getCandidate);
router.post('/:id/approve', approveTask);
router.post('/:id/reject', rejectTask);

module.exports = router;
