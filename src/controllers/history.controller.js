const {
  HistoryNotFoundError,
  historyService,
  normalizeLimit,
} = require('../services/history.service');

async function getTasks(request, response) {
  let limit;

  try {
    limit = normalizeLimit(request.query.limit);
  } catch (error) {
    response.status(400).json({
      error: error.message,
      code: 'INVALID_HISTORY_LIMIT',
    });
    return;
  }

  try {
    const tasks = await historyService.getRecentTasks(limit);
    response.status(200).json({ count: tasks.length, tasks });
  } catch (error) {
    console.error('History lookup failed:', error.message);
    response.status(500).json({ error: 'Unable to load task history' });
  }
}

async function getTask(request, response) {
  try {
    const task = await historyService.getTaskById(request.params.id);

    if (!task) {
      throw new HistoryNotFoundError(request.params.id);
    }

    response.status(200).json(task);
  } catch (error) {
    if (error instanceof HistoryNotFoundError) {
      response.status(404).json({
        error: 'History task not found',
        code: error.code,
      });
      return;
    }

    console.error('History detail lookup failed:', error.message);
    response.status(500).json({ error: 'Unable to load task history' });
  }
}

module.exports = { getTask, getTasks };
