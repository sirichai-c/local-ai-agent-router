const BaseAgentAdapter = require('./base.adapter');

function toContainerOllamaUrl(baseUrl) {
  const url = new URL(baseUrl);

  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.hostname = 'host.docker.internal';
  }

  return url.toString().replace(/\/$/u, '');
}

class AiderAdapter extends BaseAgentAdapter {
  constructor() {
    super({
      id: 'aider',
      defaultCommand: 'aider',
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

    const effectiveBaseUrl = runtime.backend === 'docker'
      ? toContainerOllamaUrl(ollamaBaseUrl)
      : ollamaBaseUrl.replace(/\/+$/u, '');

    return {
      command: input.command,
      args: [
        ...input.executionArgs,
        '--model',
        `ollama_chat/${input.model}`,
        '--message',
        input.task,
        '--no-auto-commits',
        '--no-dirty-commits',
      ],
      cwd: input.workspace,
      env: {
        OLLAMA_API_BASE: effectiveBaseUrl,
      },
      runtime,
      notes: [
        'Headless and Git-control flags are based on current official Aider documentation.',
        'The CLI is not installed locally, so this invocation is not locally verified.',
        'Aider auto-commits and dirty-worktree commits are disabled.',
      ],
    };
  }
}

module.exports = AiderAdapter;
module.exports.toContainerOllamaUrl = toContainerOllamaUrl;
