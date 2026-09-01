const { JobServiceError } = require('../services/job.service');
const { JobStateError } = require('../services/job-state.service');
const { jobManagerService } = require('../services/job-manager.service');
const { JobSchedulerError } = require('../services/job-scheduler.service');

function sendJobError(response, error) {
  if (error instanceof JobServiceError
    || error instanceof JobStateError
    || error instanceof JobSchedulerError) {
    response.status(error.statusCode || 400).json({
      error: error.message,
      code: error.code,
    });
    return;
  }
  console.error('Job operation failed:', error.message);
  response.status(500).json({
    error: 'Unable to complete the Job operation.',
    code: 'JOB_OPERATION_FAILED',
  });
}

function createJobController({ manager = jobManagerService } = {}) {
  return {
    async submit(request, response) {
      try {
        const result = await manager.submit({
          type: request.body?.type,
          task: request.body?.task,
          workspace: request.body?.workspace,
          agents: request.body?.agents,
          priority: request.body?.priority,
        });
        response.status(202).json(result);
      } catch (error) {
        sendJobError(response, error);
      }
    },

    list(request, response) {
      try {
        response.status(200).json({
          jobs: manager.listJobs({
            limit: request.query.limit === undefined ? 20 : request.query.limit,
            status: request.query.status,
          }),
          scheduler: manager.getStats(),
        });
      } catch (error) {
        sendJobError(response, error);
      }
    },

    get(request, response) {
      try {
        response.status(200).json(manager.getJob(request.params.id));
      } catch (error) {
        sendJobError(response, error);
      }
    },

    getStats(_request, response) {
      response.status(200).json(manager.getStats());
    },

    cancel(request, response) {
      try {
        response.status(200).json(manager.cancel(request.params.id));
      } catch (error) {
        sendJobError(response, error);
      }
    },

    async retry(request, response) {
      try {
        const result = await manager.retry(request.params.id, {
          priority: request.body?.priority,
        });
        response.status(202).json(result);
      } catch (error) {
        sendJobError(response, error);
      }
    },

    updatePriority(request, response) {
      try {
        response.status(200).json(
          manager.updatePriority(request.params.id, request.body?.priority),
        );
      } catch (error) {
        sendJobError(response, error);
      }
    },
  };
}

const jobController = createJobController();

module.exports = {
  createJobController,
  jobController,
  sendJobError,
};
