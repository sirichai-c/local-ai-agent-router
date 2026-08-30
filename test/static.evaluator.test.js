const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { StaticEvaluator } = require('../src/evaluators/static.evaluator');

async function createWorkspace(t, files = {}) {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-router-static-test-'),
  );
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(workspace, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents);
  }

  return workspace;
}

async function evaluateFile(t, relativePath, contents, overrides = {}) {
  const workspace = await createWorkspace(
    t,
    contents === null ? {} : { [relativePath]: contents },
  );
  const evaluator = new StaticEvaluator();
  const [result] = await evaluator.evaluate({
    workspace,
    changedFiles: [{
      path: relativePath,
      status: overrides.status || ' M',
      deleted: overrides.deleted || false,
      untracked: overrides.untracked || false,
    }],
  });

  return result;
}

test('valid JavaScript passes node syntax validation', async (t) => {
  const result = await evaluateFile(t, 'valid.js', 'const value = 42;\n');

  assert.equal(result.type, 'javascript-syntax');
  assert.equal(result.executed, true);
  assert.equal(result.passed, true);
});

test('invalid JavaScript fails without executing application code', async (t) => {
  const result = await evaluateFile(t, 'invalid.js', 'const = ;\n');

  assert.equal(result.type, 'javascript-syntax');
  assert.equal(result.passed, false);
  assert.equal(result.code, 'INVALID_JAVASCRIPT_SYNTAX');
});

test('valid JSON passes JSON.parse validation', async (t) => {
  const result = await evaluateFile(t, 'valid.json', '{"safe":true}\n');

  assert.equal(result.type, 'json-parse');
  assert.equal(result.passed, true);
});

test('invalid JSON fails without returning file contents', async (t) => {
  const result = await evaluateFile(t, 'invalid.json', '{"token":"secret",}\n');

  assert.equal(result.passed, false);
  assert.equal(result.code, 'INVALID_JSON');
  assert.equal(result.message, 'File is not valid JSON.');
  assert.doesNotMatch(result.message, /secret/u);
});

test('deleted JavaScript is skipped', async (t) => {
  const result = await evaluateFile(t, 'deleted.js', null, {
    status: ' D',
    deleted: true,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'deleted');
  assert.equal(result.passed, null);
});

test('unsupported files are skipped without failure', async (t) => {
  const result = await evaluateFile(t, 'README.md', '# Safe\n');

  assert.equal(result.applicable, false);
  assert.equal(result.passed, null);
});

test('untracked valid JavaScript is evaluated', async (t) => {
  const result = await evaluateFile(t, 'new-file.js', 'export const ok = true;\n', {
    status: '??',
    untracked: true,
  });

  assert.equal(result.executed, true);
  assert.equal(result.passed, true);
});

test('untracked invalid JavaScript fails validation', async (t) => {
  const result = await evaluateFile(t, 'new-broken.js', 'function broken( {\n', {
    status: '??',
    untracked: true,
  });

  assert.equal(result.executed, true);
  assert.equal(result.passed, false);
});

test('a changed file whose real path escapes the workspace is a hard failure', async (t) => {
  const workspace = await createWorkspace(t, {
    'escape.js': 'const safe = true;\n',
  });
  const evaluator = new StaticEvaluator({
    realpath: async (candidatePath) => (
      path.basename(candidatePath) === 'escape.js'
        ? path.resolve(workspace, '..', 'outside.js')
        : path.resolve(candidatePath)
    ),
  });
  const [result] = await evaluator.evaluate({
    workspace,
    changedFiles: [{
      path: 'escape.js',
      status: ' M',
      deleted: false,
      untracked: false,
    }],
  });

  assert.equal(result.passed, false);
  assert.equal(result.hardFail, true);
  assert.equal(result.code, 'REAL_PATH_OUTSIDE_WORKSPACE');
});
