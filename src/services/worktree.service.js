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

function validateTaskId(taskId) {
  const normalized = String(taskId).trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) {
    throw new Error(
      'taskId must contain only lowercase letters, numbers, and hyphens',
    );
  }

  return normalized;
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === ''
    || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function pathsEqual(leftPath, rightPath) {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);

  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function canonicalPath(candidatePath) {
  try {
    return await fs.realpath(path.resolve(candidatePath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return path.resolve(candidatePath);
    }

    throw error;
  }
}

async function pathsReferToSameLocation(leftPath, rightPath) {
  const [left, right] = await Promise.all([
    canonicalPath(leftPath),
    canonicalPath(rightPath),
  ]);

  return pathsEqual(left, right);
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

  async create({ repo, agentId, baseCommit, taskId: requestedTaskId }) {
    const safeAgentId = sanitizeAgentId(agentId);
    const providedTaskId = requestedTaskId === undefined
      ? null
      : validateTaskId(requestedTaskId);
    const worktreeRoot = this.getWorktreeRoot(repo);

    if (isPathInside(repo, worktreeRoot)) {
      throw new Error('Agent worktree root must be outside the target repository');
    }

    await this.mkdir(worktreeRoot, { recursive: true });

    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const taskId = providedTaskId || validateTaskId(this.idFactory());
      const directoryName = `${taskId}-${safeAgentId}`;
      const branch = `agent/${directoryName}`;
      const worktreePath = path.resolve(worktreeRoot, directoryName);
      const [branchAlreadyExists, worktreeAlreadyExists] = await Promise.all([
        this.git.branchExists(repo, branch),
        this.exists(worktreePath),
      ]);

      if (branchAlreadyExists || worktreeAlreadyExists) {
        if (providedTaskId) {
          throw new Error(
            `Agent worktree already exists for task ${providedTaskId} and agent ${safeAgentId}`,
          );
        }

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
  canonicalPath,
  isPathInside,
  pathsEqual,
  pathsReferToSameLocation,
  sanitizeAgentId,
  validateTaskId,
  worktreeService,
};
