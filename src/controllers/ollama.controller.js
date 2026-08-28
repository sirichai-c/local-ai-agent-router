const {
  OllamaServiceError,
  ollamaService,
} = require('../services/ollama.service');

function sendServiceError(error, response) {
  if (error instanceof OllamaServiceError) {
    const errorBody = {
      code: error.code,
      message: error.message,
    };

    if (error.upstreamStatus) {
      errorBody.upstreamStatus = error.upstreamStatus;
    }

    response.status(error.statusCode).json({ error: errorBody });
    return;
  }

  console.error('Unexpected Ollama integration error:', error);
  response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

async function getModels(request, response) {
  try {
    const models = await ollamaService.listModels();

    response.status(200).json({
      configuredModel: ollamaService.model,
      configuredModelAvailable: ollamaService.isConfiguredModelAvailable(models),
      models,
    });
  } catch (error) {
    sendServiceError(error, response);
  }
}

async function getOllamaHealth(request, response) {
  try {
    const health = await ollamaService.getHealth();
    const statusCode = health.modelAvailable ? 200 : 503;

    response.status(statusCode).json(health);
  } catch (error) {
    sendServiceError(error, response);
  }
}

async function postChat(request, response) {
  const { message } = request.body || {};

  if (typeof message !== 'string' || message.trim() === '') {
    response.status(400).json({
      error: {
        code: 'INVALID_MESSAGE',
        message: 'message must be a non-empty string',
      },
    });
    return;
  }

  try {
    const result = await ollamaService.chat(message.trim());
    response.status(200).json(result);
  } catch (error) {
    sendServiceError(error, response);
  }
}

module.exports = {
  getModels,
  getOllamaHealth,
  postChat,
};
