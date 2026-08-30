const BaseAgentAdapter = require('./base.adapter');

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
        OLLAMA_API_BASE: ollamaBaseUrl.replace(/\/+$/, ''),
      },
      notes: [
        'Headless and Git-control flags are based on current official Aider documentation.',
        'The CLI is not installed locally, so this invocation is not locally verified.',
        'Aider auto-commits and dirty-worktree commits are disabled.',
      ],
    };
  }
}

module.exports = AiderAdapter;
