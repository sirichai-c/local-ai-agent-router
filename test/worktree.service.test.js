const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const {
  WorktreeService,
  isPathInside,
  sanitizeAgentId,
} = require('../src/services/worktree.service');

test('worktree service creates an external branch and path from the base commit', async () => {
  const repo = path.resolve('C:\\Projects\\example-repo');
  let creation;
  let createdDirectory;
  const service = new WorktreeService({
    git: {
      branchExists: async () => false,
      createWorktree: async (input) => {
        creation = input;
      },
    },
    idFactory: () => '91f3438c210a',
    mkdir: async (directory) => {
      createdDirectory = directory;
    },
    exists: async () => false,
  });

  const result = await service.create({
    repo,
    agentId: 'OpenCode',
    baseCommit: 'abc123',
  });

  assert.equal(result.taskId, '91f3438c210a');
  assert.equal(result.branch, 'agent/91f3438c210a-opencode');
  assert.equal(result.baseCommit, 'abc123');
  assert.equal(isPathInside(repo, result.worktreePath), false);
  assert.equal(createdDirectory, path.dirname(result.worktreePath));
  assert.deepEqual(creation, {
    repo,
    branch: result.branch,
    worktreePath: result.worktreePath,
    baseRef: 'abc123',
  });
});

test('worktree service rejects a configured root inside the repository', async () => {
  const repo = path.resolve('C:\\Projects\\example-repo');
  const service = new WorktreeService({
    git: {},
    worktreeRoot: path.join(repo, '.agent-worktrees'),
  });

  await assert.rejects(
    () => service.create({ repo, agentId: 'opencode', baseCommit: 'abc123' }),
    /must be outside/,
  );
});

test('agent ids are sanitized for branch names', () => {
  assert.equal(sanitizeAgentId('Qwen Code_2'), 'qwen-code-2');
  assert.throws(() => sanitizeAgentId('!!!'), /safe branch name/);
});
