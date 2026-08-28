const BaseAgentAdapter = require('./base.adapter');

function toOpenAiCompatibleUrl(baseUrl) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  return normalizedUrl.endsWith('/v1') ? normalizedUrl : `${normalizedUrl}/v1`;
}

class OpenCodeAdapter extends BaseAgentAdapter {
  constructor() {
    super({
      id: 'opencode',
      defaultCommand: 'opencode',
    });
  }

  buildInvocation({ task, workspace, model, command, ollamaBaseUrl }) {
    const input = this.validateInvocationInput({ task, workspace, model, command });

    if (typeof ollamaBaseUrl !== 'string' || ollamaBaseUrl.trim() === '') {
      throw new TypeError('ollamaBaseUrl must be a non-empty string');
    }

    const providerModel = `ollama/${input.model}`;
    const inlineConfig = {
      provider: {
        ollama: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ollama (local)',
          options: {
            baseURL: toOpenAiCompatibleUrl(ollamaBaseUrl),
          },
          models: {
            [input.model]: {
              name: input.model,
            },
          },
        },
      },
    };

    return {
      command: input.command,
      args: [
        'run',
        '--model',
        providerModel,
        '--format',
        'json',
        input.task,
      ],
      cwd: input.workspace,
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig),
      },
      notes: [
        'OpenCode 1.18.23 run syntax was verified locally.',
        'The Ollama provider is supplied as non-secret inline runtime configuration.',
        'Automatic permission approval is not enabled.',
      ],
    };
  }
}

module.exports = OpenCodeAdapter;
module.exports.toOpenAiCompatibleUrl = toOpenAiCompatibleUrl;
