const path = require('node:path');

class BaseAgentAdapter {
  constructor({
    id,
    defaultCommand,
    allowedCommands = [defaultCommand],
    allowedExecutionCommands = allowedCommands,
  }) {
    this.id = id;
    this.defaultCommand = defaultCommand;
    this.allowedCommands = Object.freeze([...allowedCommands]);
    this.allowedExecutionCommands = Object.freeze([
      ...allowedExecutionCommands,
    ]);
  }

  validateInvocationInput({
    task,
    workspace,
    model,
    command,
    executionCommand,
    executionArgs = [],
  }) {
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

    const resolvedExecutionCommand = executionCommand || resolvedCommand;
    const executableName = path.basename(resolvedExecutionCommand).toLowerCase();
    if (!Array.isArray(executionArgs)
      || executionArgs.some((argument) => typeof argument !== 'string')) {
      throw new TypeError('executionArgs must be an array of strings');
    }

    const allowedExecutableNames = this.allowedExecutionCommands.flatMap(
      (allowedCommand) => [
        allowedCommand.toLowerCase(),
        `${allowedCommand.toLowerCase()}.exe`,
        `${allowedCommand.toLowerCase()}.cmd`,
      ],
    );

    if (!allowedExecutableNames.includes(executableName)) {
      throw new Error(`Unsupported execution command for ${this.id} adapter`);
    }

    return {
      task: task.trim(),
      workspace,
      model: model.trim(),
      command: resolvedExecutionCommand,
      executionArgs: [...executionArgs],
    };
  }

  buildInvocation() {
    throw new Error(`${this.id} adapter must implement buildInvocation()`);
  }

  async prepareExecution(invocation) {
    return invocation;
  }
}

module.exports = BaseAgentAdapter;
