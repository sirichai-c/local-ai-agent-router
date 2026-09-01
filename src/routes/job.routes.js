const express = require('express');
const { jobController } = require('../controllers/job.controller');

function createJobRouter({ controller = jobController } = {}) {
  const router = express.Router();
  router.post('/', controller.submit);
  router.get('/', controller.list);
  router.get('/stats', controller.getStats);
  router.get('/:id', controller.get);
  router.post('/:id/cancel', controller.cancel);
  router.post('/:id/retry', controller.retry);
  router.patch('/:id/priority', controller.updatePriority);
  return router;
}

const router = createJobRouter();
module.exports = router;
module.exports.createJobRouter = createJobRouter;
