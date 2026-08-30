const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');

const { GitService } = require('../src/services/git.service');
const { WorktreeService } = require('../src/services/worktree.service');

test('competition worktrees share one base commit and isolate candidate changes', async (t) => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(process.cwd(), '.phase8-test-'),
  );
  const repo = path.join(temporaryRoot, 'repository');
  const worktreeRoot = path.join(temporaryRoot, 'worktrees');
  const git = new GitService();
  const worktrees = new WorktreeService({ git, worktreeRoot });
  const created = [];

  t.after(async () => {
    for (const worktree of created) {
      await git.runGit(
        ['worktree', 'remove', '--force', worktree.worktreePath],
        repo,
        { allowFailure: true },
      );
      await git.runGit(
        ['branch', '-D', worktree.branch],
        repo,
        { allowFailure: true },
      );
    }

    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, 'README.md'), '# Test Repository\n');
  await git.runGit(['init', '--initial-branch=main'], repo);
  await git.runGit(['config', 'user.email', 'phase8@example.invalid'], repo);
  await git.runGit(['config', 'user.name', 'Phase 8 Test'], repo);
  await git.runGit(['add', 'README.md'], repo);
  await git.runGit(['commit', '-m', 'initial test repository'], repo);

  const baseCommit = await git.getHeadCommit(repo);
  created.push(await worktrees.create({
    repo,
    agentId: 'opencode',
    taskId: 'competition123',
    baseCommit,
  }));
  created.push(await worktrees.create({
    repo,
    agentId: 'qwen-code',
    taskId: 'competition123',
    baseCommit,
  }));

  await fs.appendFile(
    path.join(created[0].worktreePath, 'README.md'),
    '\nCandidate A\n',
  );
  await fs.writeFile(
    path.join(created[1].worktreePath, 'candidate.js'),
    'module.exports = true;\n',
  );

  const candidateHeads = await Promise.all(
    created.map((worktree) => git.getHeadCommit(worktree.worktreePath)),
  );

  assert.deepEqual(candidateHeads, [baseCommit, baseCommit]);
  assert.notEqual(created[0].branch, created[1].branch);
  assert.notEqual(created[0].worktreePath, created[1].worktreePath);
  assert.equal(await git.isClean(repo), true);
  assert.equal(await git.getHeadCommit(repo), baseCommit);
  assert.match(await git.getStatus(created[0].worktreePath), /README\.md/u);
  assert.match(await git.getStatus(created[1].worktreePath), /candidate\.js/u);
});
