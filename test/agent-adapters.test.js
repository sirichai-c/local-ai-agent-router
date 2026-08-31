const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  getAdapter,
} = require('../src/agents');
const AiderAdapter = require('../src/agents/aider.adapter');
const BaseAgentAdapter = require('../src/agents/base.adapter');
const OpenCodeAdapter = require('../src/agents/opencode.adapter');
const { buildOpenCodePrompt } = require('../src/agents/opencode.adapter');
const QwenCodeAdapter = require('../src/agents/qwen-code.adapter');
const {
  buildQwenPrompt,
  getQwenRuntimePath,
  toSandboxOllamaUrl,
  toQwenSandboxPath,
} = require('../src/agents/qwen-code.adapter');

const workspace = 'C:\\Projects\\example';
const model = 'qwen3.5:4b';
const ollamaBaseUrl = 'http://localhost:11434';
const task = 'fix "bug" && echo this-is-data';
const opencodeExecutable = 'C:\\tools\\opencode.exe';

function assertSafeInvocation(invocation) {
  assert.equal(typeof invocation.command, 'string');
  assert.ok(Array.isArray(invocation.args));
  assert.equal(invocation.cwd, workspace);
  assert.equal(typeof invocation.env, 'object');
  assert.ok(invocation.args.some((argument) => argument === task || argument.includes(task)));
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

test('BaseAgentAdapter execution preparation is a no-op by default', async () => {
  const adapter = new BaseAgentAdapter({ id: 'base', defaultCommand: 'base' });
  const invocation = { command: 'base', args: [], cwd: workspace, env: {} };

  assert.equal(await adapter.prepareExecution(invocation), invocation);
});

test('OpenCodeAdapter builds the locally verified headless invocation', () => {
  const adapter = new OpenCodeAdapter();
  const invocation = adapter.buildInvocation({
    task,
    workspace,
    model,
    command: 'opencode',
    executionCommand: opencodeExecutable,
    ollamaBaseUrl,
  });

  assertSafeInvocation(invocation);
  assert.equal(invocation.command, opencodeExecutable);
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
    reasoning: true,
    tool_call: true,
    interleaved: 'reasoning',
  });
});

test('OpenCodeAdapter produces pure container invocation for Docker backend', () => {
  const invocation = new OpenCodeAdapter().buildInvocation({
    task,
    workspace,
    model,
    command: 'opencode',
    executionCommand: 'opencode',
    executionArgs: [],
    ollamaBaseUrl,
    runtime: { backend: 'docker', workspace: '/workspace' },
  });

  assert.equal(invocation.command, 'opencode');
  assert.deepEqual(invocation.args.slice(0, 2), ['--pure', 'run']);
  assert.equal(
    JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT)
      .provider.ollama.options.baseURL,
    'http://host.docker.internal:11434/v1',
  );
});

test('OpenCodeAdapter anchors Docker file operations to the mounted worktree', () => {
  const prompt = buildOpenCodePrompt(task, {
    backend: 'docker',
    workspace: '/workspace',
  });

  assert.match(prompt, /\/workspace/u);
  assert.match(prompt, /never use placeholder or external paths/u);
  assert.match(prompt, new RegExp(task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  assert.equal(buildOpenCodePrompt(task, { backend: 'host' }), task);
});

test('QwenCodeAdapter preserves the command detected by the registry', () => {
  const adapter = new QwenCodeAdapter();
  const invocation = adapter.buildInvocation({
    task,
    workspace,
    model,
    command: 'qwen-code',
    ollamaBaseUrl,
  });

  assertSafeInvocation(invocation);
  assert.equal(invocation.command, 'qwen-code');
  assert.deepEqual(invocation.args.slice(0, 3), [
    '--auth-type', 'openai', '--approval-mode',
  ]);
  assert.equal(invocation.args[3], 'auto-edit');
  assert.equal(invocation.args[4], '--sandbox');
  assert.equal(invocation.args[5], '--prompt');
  assert.equal(invocation.args[6], buildQwenPrompt(task, workspace));
  assert.equal(invocation.args[7], '--model');
  assert.equal(invocation.args[8], model);
  assert.deepEqual(invocation.args.slice(9), ['--output-format', 'json']);
  assert.deepEqual(invocation.env, {
    OPENAI_API_KEY: 'ollama',
    OPENAI_BASE_URL: 'http://host.docker.internal:11434/v1',
    OPENAI_MODEL: model,
    QWEN_HOME: getQwenRuntimePath(workspace),
    QWEN_RUNTIME_DIR: getQwenRuntimePath(workspace),
    QWEN_SANDBOX: 'docker',
    QWEN_TELEMETRY_ENABLED: 'false',
    QWEN_USAGE_STATISTICS_ENABLED: 'false',
  });
});

test('QwenCodeAdapter prepares isolated runtime settings only for execution', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-adapter-'));
  const temporaryWorkspace = path.join(temporaryRoot, 'worktree');
  await fs.mkdir(temporaryWorkspace);
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const adapter = new QwenCodeAdapter();
  const invocation = adapter.buildInvocation({
    task,
    workspace: temporaryWorkspace,
    model,
    command: 'qwen',
    ollamaBaseUrl,
  });
  const runtimePath = getQwenRuntimePath(temporaryWorkspace);

  await assert.rejects(() => fs.stat(runtimePath), { code: 'ENOENT' });
  const preparedInvocation = await adapter.prepareExecution(invocation);
  const preparedSettings = JSON.parse(
    await fs.readFile(path.join(runtimePath, 'settings.json'), 'utf8'),
  );

  assert.equal(preparedInvocation.env.QWEN_HOME, runtimePath);
  assert.equal(preparedSettings.tools.sandbox, 'docker');
  assert.equal(
    preparedSettings.model.generationConfig.extra_body.reasoning_effort,
    'none',
  );
});

test('QwenCodeAdapter avoids nested Docker and host runtime writes in Router sandbox', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-container-'));
  const temporaryWorkspace = path.join(temporaryRoot, 'worktree');
  await fs.mkdir(temporaryWorkspace);
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const adapter = new QwenCodeAdapter();
  const invocation = adapter.buildInvocation({
    task,
    workspace: temporaryWorkspace,
    model,
    command: 'qwen',
    executionCommand: 'qwen',
    executionArgs: [],
    ollamaBaseUrl,
    runtime: { backend: 'docker', workspace: '/workspace' },
  });
  const prepared = await adapter.prepareExecution(invocation);

  assert.equal(invocation.args.includes('--sandbox'), false);
  assert.equal(invocation.args.includes('--safe-mode'), true);
  assert.match(invocation.args.join('\n'), /\/workspace/u);
  assert.equal(invocation.env.QWEN_HOME, '/tmp/qwen');
  assert.equal(invocation.env.QWEN_SANDBOX, undefined);
  assert.equal(prepared, invocation);
  await assert.rejects(
    () => fs.stat(getQwenRuntimePath(temporaryWorkspace)),
    { code: 'ENOENT' },
  );
});

test('QwenCodeAdapter maps loopback Ollama URLs to the Docker host', () => {
  assert.equal(
    toSandboxOllamaUrl('http://127.0.0.1:11434'),
    'http://host.docker.internal:11434/v1',
  );
  assert.equal(
    toSandboxOllamaUrl('http://ollama.internal:11434/v1'),
    'http://ollama.internal:11434/v1',
  );
});

test('QwenCodeAdapter maps Windows worktrees to the installed sandbox path', () => {
  assert.equal(
    toQwenSandboxPath('C:\\Projects\\example'),
    '/c/Projects/example',
  );
  assert.match(buildQwenPrompt(task, workspace), /\/c\/Projects\/example/);
});

test('QwenCodeAdapter preserves the Router Docker workspace path', () => {
  assert.equal(toQwenSandboxPath('/workspace'), '/workspace');
});

test('QwenCodeAdapter isolates its runtime from the real user profile', () => {
  const runtimePath = getQwenRuntimePath(workspace);

  assert.equal(path.dirname(path.dirname(runtimePath)), path.dirname(workspace));
  assert.equal(path.basename(path.dirname(runtimePath)), '.qwen-runtime');
  assert.equal(path.basename(runtimePath), path.basename(workspace));
});

test('QwenCodeAdapter accepts only its trusted Node launcher entry point', () => {
  const adapter = new QwenCodeAdapter();
  const qwenEntry = 'C:\\npm\\node_modules\\@qwen-code\\qwen-code\\cli-entry.js';
  const invocation = adapter.buildInvocation({
    task,
    workspace,
    model,
    command: 'qwen',
    executionCommand: 'C:\\runtime\\node.exe',
    executionArgs: [qwenEntry],
    ollamaBaseUrl,
  });

  assertSafeInvocation(invocation);
  assert.equal(invocation.command, 'C:\\runtime\\node.exe');
  assert.equal(invocation.args[0], qwenEntry);

  assert.throws(
    () => adapter.buildInvocation({
      task,
      workspace,
      model,
      command: 'qwen',
      executionCommand: 'C:\\runtime\\node.exe',
      executionArgs: ['C:\\untrusted\\script.js'],
      ollamaBaseUrl,
    }),
    /trusted CLI entry point/,
  );
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

test('adapters reject arbitrary execution paths', () => {
  const adapter = new OpenCodeAdapter();

  assert.throws(
    () => adapter.buildInvocation({
      task,
      workspace,
      model,
      command: 'opencode',
      executionCommand: 'C:\\tools\\arbitrary.exe',
      ollamaBaseUrl,
    }),
    /Unsupported execution command/,
  );
});

test('getAdapter returns the registered adapter or null', () => {
  assert.ok(getAdapter('opencode') instanceof OpenCodeAdapter);
  assert.ok(getAdapter('qwen-code') instanceof QwenCodeAdapter);
  assert.ok(getAdapter('aider') instanceof AiderAdapter);
  assert.equal(getAdapter('does-not-exist'), null);
});
