const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const {
  GitService,
  parseChangedFiles,
} = require('../src/services/git.service');

const git = new GitService();
let repo;
let tempRoot;

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-router-git-test-'));
  repo = path.join(tempRoot, 'repo');
  await fs.mkdir(repo);
  await git.runGit(['init'], repo);
  await git.runGit(['config', 'user.name', 'Phase 6 Test'], repo);
  await git.runGit(['config', 'user.email', 'phase6@example.invalid'], repo);
  await fs.writeFile(path.join(repo, 'README.md'), '# Disposable repository\n');
  await git.runGit(['add', 'README.md'], repo);
  await git.runGit(['commit', '-m', 'initial test repository'], repo);
});

after(async () => {
  const resolvedTempRoot = path.resolve(tempRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());

  assert.equal(resolvedTempRoot.startsWith(resolvedSystemTemp), true);
  assert.match(path.basename(resolvedTempRoot), /^agent-router-git-test-/);
  await fs.rm(resolvedTempRoot, { recursive: true, force: true });
});

test('Git service resolves repository metadata and clean state', async () => {
  const [repoRoot, branch, head, clean] = await Promise.all([
    git.getRepoRoot(repo),
    git.getCurrentBranch(repo),
    git.getHeadCommit(repo),
    git.isClean(repo),
  ]);

  assert.equal(repoRoot.toLowerCase(), (await fs.realpath(repo)).toLowerCase());
  assert.notEqual(branch, '');
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(clean, true);
});

test('Git service returns tracked and untracked changes without hiding status', async () => {
  await fs.appendFile(path.join(repo, 'README.md'), '\nChanged\n');
  await fs.writeFile(path.join(repo, 'untracked file.txt'), 'new\n');

  const changedFiles = await git.getChangedFiles(repo);
  const diff = await git.getDiff(repo);

  assert.deepEqual(changedFiles, [
    { status: ' M', file: 'README.md' },
    { status: '??', file: '"untracked file.txt"' },
  ]);
  assert.match(diff, /\+Changed/);
  assert.doesNotMatch(diff, /untracked file/);
  assert.equal(await git.isClean(repo), false);
});

test('parseChangedFiles preserves the two-column porcelain status', () => {
  assert.deepEqual(parseChangedFiles('M  staged.js\n D deleted.js\n?? new.js\n'), [
    { status: 'M ', file: 'staged.js' },
    { status: ' D', file: 'deleted.js' },
    { status: '??', file: 'new.js' },
  ]);
});
