const BaseAgentAdapter = require('./base.adapter');

function toOpenAiCompatibleUrl(baseUrl) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  return normalizedUrl.endsWith('/v1') ? normalizedUrl : `${normalizedUrl}/v1`;
}

function toContainerUrl(baseUrl) {
  const url = new URL(baseUrl);

  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.hostname = 'host.docker.internal';
  }

  return url.toString().replace(/\/$/u, '');
}

function buildOpenCodePrompt(task, runtime) {
  if (runtime.backend !== 'docker') {
    return task;
  }

  return [
    `You are operating in the isolated repository worktree at: ${runtime.workspace}`,
    'Use that exact directory for every file operation. Resolve relative paths against it and never use placeholder or external paths such as /home/runner/work.',
    'Modify only files required by the task, then stop after the requested change succeeds.',
    task,
  ].join('\n\n');
}

class OpenCodeAdapter extends BaseAgentAdapter {
  constructor() {
    super({
      id: 'opencode',
      defaultCommand: 'opencode',
    });
  }

  buildInvocation({
    task,
    workspace,
    model,
    command,
    executionCommand,
    executionArgs,
    ollamaBaseUrl,
    runtime = { backend: 'host', workspace },
  }) {
    const input = this.validateInvocationInput({
      task,
      workspace,
      model,
      command,
      executionCommand,
      executionArgs,
    });

    if (typeof ollamaBaseUrl !== 'string' || ollamaBaseUrl.trim() === '') {
      throw new TypeError('ollamaBaseUrl must be a non-empty string');
    }

    const providerModel = `ollama/${input.model}`;
    const effectiveBaseUrl = runtime.backend === 'docker'
      ? toContainerUrl(ollamaBaseUrl)
      : ollamaBaseUrl;
    const inlineConfig = {
      provider: {
        ollama: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ollama (local)',
          options: {
            baseURL: toOpenAiCompatibleUrl(effectiveBaseUrl),
          },
          models: {
            [input.model]: {
              name: input.model,
              reasoning: true,
              tool_call: true,
              interleaved: 'reasoning',
            },
          },
        },
      },
    };

    return {
      command: input.command,
      args: [
        ...input.executionArgs,
        ...(runtime.backend === 'docker' ? ['--pure'] : []),
        'run',
        '--model',
        providerModel,
        '--format',
        'json',
        buildOpenCodePrompt(input.task, runtime),
      ],
      cwd: input.workspace,
      runtime,
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
module.exports.toContainerUrl = toContainerUrl;
module.exports.buildOpenCodePrompt = buildOpenCodePrompt;
