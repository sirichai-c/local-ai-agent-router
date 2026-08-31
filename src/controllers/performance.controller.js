const { TASK_CATEGORIES } = require('../config/task-rules');
const {
  agentRegistryService,
} = require('../services/agent-registry.service');
const { performanceService } = require('../services/performance.service');

async function resolveAgent(agentId, response) {
  const agent = await agentRegistryService.getAgentById(agentId);

  if (!agent) {
    response.status(404).json({ error: 'Agent not found' });
    return null;
  }

  return agent;
}

function publicAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    installed: agent.installed,
    available: agent.available,
  };
}

async function getAgentPerformance(request, response) {
  try {
    const agent = await resolveAgent(request.params.id, response);

    if (!agent) {
      return;
    }

    response.status(200).json({
      agent: publicAgent(agent),
      global: performanceService.getAgentGlobalStats(agent.id),
      recent: performanceService.getAgentRecentStats(agent.id),
    });
  } catch (error) {
    console.error('Agent performance lookup failed:', error.message);
    response.status(500).json({ error: 'Unable to load agent performance' });
  }
}

async function getAgentCategoryPerformance(request, response) {
  const { category, id } = request.params;

  if (!TASK_CATEGORIES.includes(category)) {
    response.status(400).json({
      error: 'Unknown task category',
      code: 'UNKNOWN_TASK_CATEGORY',
    });
    return;
  }

  try {
    const agent = await resolveAgent(id, response);

    if (!agent) {
      return;
    }

    response.status(200).json({
      agent: publicAgent(agent),
      category,
      performance: performanceService.getAgentCategoryStats(
        agent.id,
        category,
      ),
    });
  } catch (error) {
    console.error('Agent category performance lookup failed:', error.message);
    response.status(500).json({ error: 'Unable to load agent performance' });
  }
}

module.exports = {
  getAgentCategoryPerformance,
  getAgentPerformance,
};
