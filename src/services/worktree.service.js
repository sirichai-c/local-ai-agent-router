const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { config } = require('../config/env');
const { gitService } = require('./git.service');

const MAX_ID_ATTEMPTS = 5;

function createTaskId() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

function sanitizeAgentId(agentId) {
  const sanitized = String(agentId)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!sanitized) {
    throw new Error('agentId cannot be converted to a safe branch name');
  }

  return sanitized;
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === ''
    || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function pathExists(candidatePath) {
  try {
    await fs.stat(candidatePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

class WorktreeService {
  constructor({
    git = gitService,
    worktreeRoot = config.agentExecution.worktreeRoot,
    idFactory = createTaskId,
    mkdir = fs.mkdir,
    exists = pathExists,
  } = {}) {
    this.git = git;
    this.worktreeRoot = worktreeRoot;
    this.idFactory = idFactory;
    this.mkdir = mkdir;
    this.exists = exists;
  }

  getWorktreeRoot(repo) {
    if (this.worktreeRoot) {
      return path.resolve(this.worktreeRoot);
    }

    return path.resolve(
      path.dirname(repo),
      '.agent-worktrees',
      path.basename(repo),
    );
  }

  async create({ repo, agentId, baseCommit }) {
    const safeAgentId = sanitizeAgentId(agentId);
    const worktreeRoot = this.getWorktreeRoot(repo);

    if (isPathInside(repo, worktreeRoot)) {
      throw new Error('Agent worktree root must be outside the target repository');
    }

    await this.mkdir(worktreeRoot, { recursive: true });

    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const taskId = this.idFactory();
      const directoryName = `${taskId}-${safeAgentId}`;
      const branch = `agent/${directoryName}`;
      const worktreePath = path.resolve(worktreeRoot, directoryName);
      const [branchAlreadyExists, worktreeAlreadyExists] = await Promise.all([
        this.git.branchExists(repo, branch),
        this.exists(worktreePath),
      ]);

      if (branchAlreadyExists || worktreeAlreadyExists) {
        continue;
      }

      await this.git.createWorktree({
        repo,
        branch,
        worktreePath,
        baseRef: baseCommit,
      });

      return {
        taskId,
        repo,
        worktreePath,
        branch,
        baseCommit,
      };
    }

    throw new Error('Unable to allocate a unique agent worktree');
  }
}

const worktreeService = new WorktreeService();

module.exports = {
  WorktreeService,
  createTaskId,
  isPathInside,
  sanitizeAgentId,
  worktreeService,
};
