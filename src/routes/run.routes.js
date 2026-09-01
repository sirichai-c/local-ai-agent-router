const express = require('express');

const { runController } = require('../controllers/run.controller');

function createRunRouter({ controller = runController } = {}) {
  const router = express.Router();
  router.post('/execute', controller.startExecution);
  router.post('/compete', controller.startCompetition);
  router.get('/:runId', controller.getRun);
  router.get('/:runId/events', controller.streamEvents);
  return router;
}

const router = createRunRouter();

module.exports = router;
module.exports.createRunRouter = createRunRouter;
