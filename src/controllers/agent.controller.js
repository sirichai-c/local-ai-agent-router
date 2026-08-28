const {
  agentRegistryService,
} = require('../services/agent-registry.service');

function sendDetectionError(error, response) {
  console.error('Agent command detection failed:', error.message);
  response.status(500).json({
    error: 'Unable to inspect coding agents',
  });
}

async function getAgents(request, response) {
  try {
    const agents = await agentRegistryService.getAgents();

    response.status(200).json({
      count: agents.length,
      agents,
    });
  } catch (error) {
    sendDetectionError(error, response);
  }
}

async function getAgent(request, response) {
  try {
    const agent = await agentRegistryService.getAgentById(request.params.id);

    if (!agent) {
      response.status(404).json({
        error: 'Agent not found',
      });
      return;
    }

    response.status(200).json(agent);
  } catch (error) {
    sendDetectionError(error, response);
  }
}

module.exports = {
  getAgent,
  getAgents,
};
