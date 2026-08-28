const { config } = require('../config/env');

const REQUEST_TIMEOUT_MS = 120_000;

class OllamaServiceError extends Error {
  constructor(message, { code, statusCode, upstreamStatus } = {}) {
    super(message);
    this.name = 'OllamaServiceError';
    this.code = code || 'OLLAMA_ERROR';
    this.statusCode = statusCode || 502;
    this.upstreamStatus = upstreamStatus;
  }
}

class OllamaService {
  constructor({
    baseUrl = config.ollama.baseUrl,
    model = config.ollama.model,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('A fetch implementation is required');
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    let response;

    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          accept: 'application/json',
          ...options.headers,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new OllamaServiceError('Ollama request timed out', {
          code: 'OLLAMA_TIMEOUT',
          statusCode: 504,
        });
      }

      throw new OllamaServiceError('Unable to connect to Ollama', {
        code: 'OLLAMA_UNAVAILABLE',
        statusCode: 503,
      });
    }

    const responseText = await response.text();
    let body = {};

    if (responseText) {
      try {
        body = JSON.parse(responseText);
      } catch {
        throw new OllamaServiceError('Ollama returned an invalid JSON response', {
          code: 'OLLAMA_INVALID_RESPONSE',
          statusCode: 502,
          upstreamStatus: response.status,
        });
      }
    }

    if (!response.ok) {
      const upstreamMessage = typeof body.error === 'string' ? body.error : '';
      const modelNotFound = response.status === 404
        && upstreamMessage.toLowerCase().includes('model')
        && upstreamMessage.toLowerCase().includes('not found');

      if (modelNotFound) {
        throw this.createModelNotFoundError();
      }

      throw new OllamaServiceError('Ollama returned an HTTP error', {
        code: 'OLLAMA_HTTP_ERROR',
        statusCode: 502,
        upstreamStatus: response.status,
      });
    }

    return body;
  }

  async listModels() {
    const body = await this.request('/api/tags');

    if (!Array.isArray(body.models)) {
      throw new OllamaServiceError('Ollama response did not include a model list', {
        code: 'OLLAMA_INVALID_RESPONSE',
        statusCode: 502,
      });
    }

    return body.models.map((model) => ({
      name: model.name,
      model: model.model,
      modifiedAt: model.modified_at,
      size: model.size,
      digest: model.digest,
      details: model.details,
    }));
  }

  isConfiguredModelAvailable(models) {
    return models.some((model) => (
      model.name === this.model || model.model === this.model
    ));
  }

  createModelNotFoundError() {
    return new OllamaServiceError(
      `Configured Ollama model "${this.model}" is not installed`,
      {
        code: 'OLLAMA_MODEL_NOT_FOUND',
        statusCode: 503,
        upstreamStatus: 404,
      },
    );
  }

  async getHealth() {
    const models = await this.listModels();
    const modelAvailable = this.isConfiguredModelAvailable(models);

    return {
      status: modelAvailable ? 'ok' : 'degraded',
      service: 'ollama',
      model: this.model,
      modelAvailable,
    };
  }

  async chat(message) {
    const models = await this.listModels();

    if (!this.isConfiguredModelAvailable(models)) {
      throw this.createModelNotFoundError();
    }

    const body = await this.request('/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
        stream: false,
      }),
    });

    if (typeof body.message?.content !== 'string') {
      throw new OllamaServiceError('Ollama response did not include a chat message', {
        code: 'OLLAMA_INVALID_RESPONSE',
        statusCode: 502,
      });
    }

    return {
      model: body.model || this.model,
      message: {
        role: body.message.role || 'assistant',
        content: body.message.content,
      },
      done: body.done === true,
      doneReason: body.done_reason || null,
      metrics: {
        totalDuration: body.total_duration,
        loadDuration: body.load_duration,
        promptEvalCount: body.prompt_eval_count,
        evalCount: body.eval_count,
      },
    };
  }
}

const ollamaService = new OllamaService();

module.exports = {
  OllamaService,
  OllamaServiceError,
  ollamaService,
};
