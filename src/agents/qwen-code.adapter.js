const BaseAgentAdapter = require('./base.adapter');

class QwenCodeAdapter extends BaseAgentAdapter {
  constructor() {
    super({
      id: 'qwen-code',
      defaultCommand: 'qwen',
      allowedCommands: ['qwen', 'qwen-code'],
    });
  }

  buildInvocation({ task, workspace, model, command }) {
    const input = this.validateInvocationInput({ task, workspace, model, command });

    return {
      command: input.command,
      args: [
        '--prompt',
        input.task,
        '--model',
        input.model,
        '--output-format',
        'json',
      ],
      cwd: input.workspace,
      env: {},
      notes: [
        'Headless flags are based on current official Qwen Code documentation.',
        'The CLI is not installed locally, so this invocation is not locally verified.',
        'Local Ollama provider setup must already exist in Qwen Code settings.',
      ],
    };
  }
}

module.exports = QwenCodeAdapter;
