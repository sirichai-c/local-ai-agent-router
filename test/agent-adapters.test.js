const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  getAdapter,
} = require('../src/agents');
const AiderAdapter = require('../src/agents/aider.adapter');
const BaseAgentAdapter = require('../src/agents/base.adapter');
const OpenCodeAdapter = require('../src/agents/opencode.adapter');
const QwenCodeAdapter = require('../src/agents/qwen-code.adapter');

const workspace = 'C:\\Projects\\example';
const model = 'qwen3.5:4b';
const ollamaBaseUrl = 'http://localhost:11434';
const task = 'fix "bug" && echo this-is-data';

function assertSafeInvocation(invocation) {
  assert.equal(typeof invocation.command, 'string');
  assert.ok(Array.isArray(invocation.args));
  assert.equal(invocation.cwd, workspace);
  assert.equal(typeof invocation.env, 'object');
  assert.ok(invocation.args.includes(task));
  assert.equal(invocation.args.filter((argument) => argument === task).length, 1);
}

test('BaseAgentAdapter defines an abstract invocation contract', () => {
  const adapter = new BaseAgentAdapter({
    id: 'base',
    defaultCommand: 'base',
  });

  assert.throws(
    () => adapter.buildInvocation(),
    /base adapter must implement buildInvocation/,
  );
});

test('OpenCodeAdapter builds the locally verified headless invocation', () => {
  const adapter = new OpenCodeAdapter();
  const invocation = adapter.buildInvocation({
    task,
    workspace,
    model,
    command: 'opencode',
    ollamaBaseUrl,
  });

  assertSafeInvocation(invocation);
  assert.equal(invocation.command, 'opencode');
  assert.deepEqual(invocation.args, [
    'run',
    '--model',
    'ollama/qwen3.5:4b',
    '--format',
    'json',
    task,
  ]);
  assert.equal(invocation.args.includes('--auto'), false);

  const inlineConfig = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT);
  const ollamaProvider = inlineConfig.provider.ollama;

  assert.equal(ollamaProvider.options.baseURL, 'http://localhost:11434/v1');
  assert.deepEqual(ollamaProvider.models['qwen3.5:4b'], {
    name: 'qwen3.5:4b',
  });
});

test('QwenCodeAdapter preserves the command detected by the registry', () => {
  const adapter = new QwenCodeAdapter();
  const invocation = adapter.buildInvocation({
    task,
    workspace,
    model,
    command: 'qwen-code',
  });

  assertSafeInvocation(invocation);
  assert.equal(invocation.command, 'qwen-code');
  assert.deepEqual(invocation.args, [
    '--prompt',
    task,
    '--model',
    model,
    '--output-format',
    'json',
  ]);
});

test('AiderAdapter disables agent-controlled Git commits', () => {
  const adapter = new AiderAdapter();
  const invocation = adapter.buildInvocation({
    task,
    workspace,
    model,
    command: 'aider',
    ollamaBaseUrl,
  });

  assertSafeInvocation(invocation);
  assert.equal(invocation.command, 'aider');
  assert.deepEqual(invocation.args, [
    '--model',
    'ollama_chat/qwen3.5:4b',
    '--message',
    task,
    '--no-auto-commits',
    '--no-dirty-commits',
  ]);
  assert.equal(invocation.env.OLLAMA_API_BASE, ollamaBaseUrl);
});

test('adapters reject command overrides outside their allowlists', () => {
  const adapter = new OpenCodeAdapter();

  assert.throws(
    () => adapter.buildInvocation({
      task,
      workspace,
      model,
      command: 'user-controlled-command',
      ollamaBaseUrl,
    }),
    /Unsupported command/,
  );
});

test('getAdapter returns the registered adapter or null', () => {
  assert.ok(getAdapter('opencode') instanceof OpenCodeAdapter);
  assert.ok(getAdapter('qwen-code') instanceof QwenCodeAdapter);
  assert.ok(getAdapter('aider') instanceof AiderAdapter);
  assert.equal(getAdapter('does-not-exist'), null);
});
