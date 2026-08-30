const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { DiffEvaluator } = require('../src/evaluators/diff.evaluator');
const { EvaluatorService } = require('../src/services/evaluator.service');
const { GitService } = require('../src/services/git.service');

const git = new GitService();
const execution = Object.freeze({
  exitCode: 0,
  timedOut: false,
  outputTruncated: false,
});

async function createRepository(t, files = { 'README.md': '# Test\n' }) {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-router-evaluator-test-'),
  );
  const repo = path.join(tempRoot, 'repo');
  await fs.mkdir(repo);
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  await git.runGit(['init'], repo);
  await git.runGit(['config', 'user.name', 'Phase 7 Test'], repo);
  await git.runGit(['config', 'user.email', 'phase7@example.invalid'], repo);

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(repo, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents);
  }

  await git.runGit(['add', '.'], repo);
  await git.runGit(['commit', '-m', 'initial evaluator test repository'], repo);

  return {
    repo,
    baseCommit: await git.getHeadCommit(repo),
  };
}

function createService(overrides = {}) {
  return new EvaluatorService({
    untrackedFileProvider: (workspace) => git.getUntrackedFiles(workspace),
    ...overrides,
  });
}

async function evaluateRepository(repository, service = createService()) {
  const [changedFiles, trackedDiff] = await Promise.all([
    git.getChangedFiles(repository.repo),
    git.getDiff(repository.repo),
  ]);

  return service.evaluateAgentResult({
    workspace: repository.repo,
    execution,
    baseCommit: repository.baseCommit,
    changedFiles,
    trackedDiff,
    unexpectedCommit: false,
  });
}

test('README-only modification receives a passing evaluation', async (t) => {
  const repository = await createRepository(t);
  await fs.appendFile(path.join(repository.repo, 'README.md'), '\nSafe change\n');

  const result = await evaluateRepository(repository);

  assert.equal(result.score, 100);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.summary.changedFileCount, 1);
  assert.equal(result.summary.staticChecksFailed, 0);
});

test('valid tracked JavaScript is syntax checked and passes', async (t) => {
  const repository = await createRepository(t, {
    'src/app.js': 'const value = 1;\n',
  });
  await fs.writeFile(path.join(repository.repo, 'src/app.js'), 'const value = 2;\n');

  const result = await evaluateRepository(repository);

  assert.equal(result.verdict, 'pass');
  assert.equal(result.summary.staticChecksPassed, 1);
  assert.equal(result.staticChecks[0].type, 'javascript-syntax');
});

test('invalid tracked JavaScript produces a fail verdict', async (t) => {
  const repository = await createRepository(t, {
    'src/app.js': 'const value = 1;\n',
  });
  await fs.writeFile(path.join(repository.repo, 'src/app.js'), 'const = ;\n');

  const result = await evaluateRepository(repository);

  assert.equal(result.verdict, 'fail');
  assert.equal(result.summary.staticChecksFailed, 1);
});

test('untracked sensitive file creation is a hard fail', async (t) => {
  const repository = await createRepository(t);
  await fs.writeFile(path.join(repository.repo, '.env'), 'SECRET=redacted\n');

  const result = await evaluateRepository(repository);

  assert.equal(result.verdict, 'fail');
  assert.equal(result.hardFail, true);
  assert.equal(result.summary.sensitiveFilesDetected, 1);
  assert.equal(result.reasons.some((reason) => reason.file === '.env'), true);
});

test('untracked JavaScript is counted and checked when tracked diff is empty', async (t) => {
  const repository = await createRepository(t);
  await fs.writeFile(
    path.join(repository.repo, 'new-file.js'),
    'const untracked = true;\n',
  );
  const trackedDiff = await git.getDiff(repository.repo);

  assert.equal(trackedDiff, '');

  const result = await evaluateRepository(repository);

  assert.equal(result.verdict, 'pass');
  assert.equal(result.diff.trackedDiffBytes, 0);
  assert.deepEqual(result.diff.untrackedFiles, ['new-file.js']);
  assert.equal(result.summary.changedFileCount, 1);
  assert.equal(result.summary.staticChecksPassed, 1);
});

test('too many changed files produces a warning with a small test limit', async (t) => {
  const repository = await createRepository(t);
  await fs.writeFile(path.join(repository.repo, 'one.md'), 'one\n');
  await fs.writeFile(path.join(repository.repo, 'two.md'), 'two\n');
  const service = createService({
    diff: new DiffEvaluator({ maxChangedFiles: 1 }),
  });

  const result = await evaluateRepository(repository, service);

  assert.equal(result.diff.tooManyFiles, true);
  assert.equal(result.score, 80);
  assert.equal(result.verdict, 'warning');
});

test('oversized tracked diff produces a warning with a small test limit', async (t) => {
  const repository = await createRepository(t);
  await fs.appendFile(path.join(repository.repo, 'README.md'), 'x'.repeat(100));
  const service = createService({
    diff: new DiffEvaluator({ maxDiffBytes: 10 }),
  });

  const result = await evaluateRepository(repository, service);

  assert.equal(result.diff.diffTooLarge, true);
  assert.equal(result.score, 85);
  assert.equal(result.verdict, 'warning');
});
