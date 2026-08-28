class BaseAgentAdapter {
  constructor({ id, defaultCommand, allowedCommands = [defaultCommand] }) {
    this.id = id;
    this.defaultCommand = defaultCommand;
    this.allowedCommands = Object.freeze([...allowedCommands]);
  }

  validateInvocationInput({ task, workspace, model, command }) {
    if (typeof task !== 'string' || task.trim() === '') {
      throw new TypeError('task must be a non-empty string');
    }

    if (typeof workspace !== 'string' || workspace.trim() === '') {
      throw new TypeError('workspace must be a non-empty string');
    }

    if (typeof model !== 'string' || model.trim() === '') {
      throw new TypeError('model must be a non-empty string');
    }

    const resolvedCommand = command || this.defaultCommand;

    if (!this.allowedCommands.includes(resolvedCommand)) {
      throw new Error(`Unsupported command for ${this.id} adapter`);
    }

    return {
      task: task.trim(),
      workspace,
      model: model.trim(),
      command: resolvedCommand,
    };
  }

  buildInvocation() {
    throw new Error(`${this.id} adapter must implement buildInvocation()`);
  }
}

module.exports = BaseAgentAdapter;
