const fs = require('node:fs/promises');
const path = require('node:path');

const { processRunnerService } = require('./process-runner.service');

const GIT_TIMEOUT_MS = 30_000;

class GitCommandError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'GitCommandError';
    this.result = result;
  }
}

class RepositoryValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RepositoryValidationError';
    this.code = code;
  }
}

function parseChangedFiles(statusOutput) {
  if (statusOutput.includes('\0')) {
    const records = statusOutput.split('\0');
    const changes = [];

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];

      if (!record) {
        continue;
      }

      const status = record.slice(0, 2);
      const change = {
        status,
        file: record.length > 3 ? record.slice(3) : '',
      };

      if (status.includes('R') || status.includes('C')) {
        change.originalFile = records[index + 1] || '';
        index += 1;
      }

      changes.push(change);
    }

    return changes;
  }

  return statusOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2),
      file: line.length > 3 ? line.slice(3) : '',
    }));
}

function parseNullDelimitedPaths(output) {
  return output
    .split('\0')
    .filter(Boolean)
    .map((filePath) => filePath.replace(/\\/gu, '/'));
}

function parseWorktreeList(output) {
  const worktrees = [];
  let current = null;

  for (const field of output.split('\0')) {
    if (field === '') {
      if (current) {
        worktrees.push(current);
        current = null;
      }
      continue;
    }

    const separator = field.indexOf(' ');
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? true : field.slice(separator + 1);

    if (key === 'worktree') {
      if (current) {
        worktrees.push(current);
      }

      current = { path: path.resolve(value), branch: null, head: null };
    } else if (current && key === 'branch') {
      current.branch = String(value).replace(/^refs\/heads\//u, '');
    } else if (current && key === 'HEAD') {
      current.head = value;
    } else if (current) {
      current[key] = value;
    }
  }

  if (current) {
    worktrees.push(current);
  }

  return worktrees;
}

class GitService {
  constructor({
    runner = processRunnerService,
    command = process.platform === 'win32' ? 'git.exe' : 'git',
  } = {}) {
    this.runner = runner;
    this.command = command;
  }

  async runGit(args, cwd, { allowFailure = false } = {}) {
    const result = await this.runner.runProcess({
      command: this.command,
      args,
      cwd,
      env: {},
      timeoutMs: GIT_TIMEOUT_MS,
    });

    if (!allowFailure && (result.exitCode !== 0 || result.timedOut)) {
      throw new GitCommandError(
        `Git command failed: git ${args[0] || ''}`.trim(),
        result,
      );
    }

    return result;
  }

  async getRepoRoot(workspace) {
    const result = await this.runGit(
      ['rev-parse', '--show-toplevel'],
      workspace,
      { allowFailure: true },
    );

    if (result.exitCode !== 0 || result.timedOut) {
      throw new RepositoryValidationError(
        'Workspace is not inside a Git repository.',
        'NOT_GIT_REPOSITORY',
      );
    }

    return path.resolve(result.stdout.trim());
  }

  async getCurrentBranch(repo) {
    const result = await this.runGit(['branch', '--show-current'], repo);
    return result.stdout.trim();
  }

  async getHeadCommit(repo) {
    const result = await this.runGit(['rev-parse', '--verify', 'HEAD'], repo);
    return result.stdout.trim();
  }

  async getStatus(repo) {
    const result = await this.runGit(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      repo,
    );
    return result.stdout;
  }

  async isClean(repo) {
    return (await this.getStatus(repo)).trim() === '';
  }

  async getDiff(repo) {
    const result = await this.getDiffResult(repo);
    return result.stdout;
  }

  async getDiffResult(repo) {
    return this.runGit(
      ['diff', '--no-ext-diff', 'HEAD', '--'],
      repo,
    );
  }

  async getChangedFiles(repo) {
    const result = await this.runGit(
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      repo,
    );
    return parseChangedFiles(result.stdout);
  }

  async getUntrackedFiles(repo) {
    const result = await this.runGit(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      repo,
    );
    return parseNullDelimitedPaths(result.stdout);
  }

  async branchExists(repo, branch) {
    const result = await this.runGit(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      repo,
      { allowFailure: true },
    );

    if (result.exitCode === 0) {
      return true;
    }

    if (result.exitCode === 1) {
      return false;
    }

    throw new GitCommandError('Unable to inspect Git branch', result);
  }

  async createWorktree({ repo, branch, worktreePath, baseRef }) {
    await this.runGit(
      ['worktree', 'add', '-b', branch, worktreePath, baseRef],
      repo,
    );
  }

  async getWorktrees(repo) {
    const result = await this.runGit(
      ['worktree', 'list', '--porcelain', '-z'],
      repo,
    );
    return parseWorktreeList(result.stdout);
  }

  async getBranchCommit(repo, branch) {
    const result = await this.runGit(
      ['rev-parse', '--verify', `refs/heads/${branch}`],
      repo,
    );
    return result.stdout.trim();
  }

  async stageAll(repo) {
    await this.runGit(['add', '-A', '--'], repo);
  }

  async unstageAll(repo) {
    return this.runGit(
      ['reset', '--mixed', 'HEAD', '--'],
      repo,
      { allowFailure: true },
    );
  }

  async hasStagedChanges(repo) {
    const result = await this.runGit(
      ['diff', '--cached', '--quiet', '--exit-code', '--'],
      repo,
      { allowFailure: true },
    );

    if (result.exitCode === 0) {
      return false;
    }

    if (result.exitCode === 1) {
      return true;
    }

    throw new GitCommandError('Unable to inspect staged candidate changes', result);
  }

  async getStagedDiff(repo) {
    const result = await this.runGit(
      ['diff', '--cached', '--binary', '--full-index', 'HEAD', '--'],
      repo,
    );

    if (result.outputTruncated) {
      throw new GitCommandError('Staged candidate diff exceeded the output limit', result);
    }

    return result.stdout;
  }

  async getCommitDiff(repo, baseCommit, candidateCommit) {
    const result = await this.runGit(
      [
        'diff',
        '--binary',
        '--full-index',
        baseCommit,
        candidateCommit,
        '--',
      ],
      repo,
    );

    if (result.outputTruncated) {
      throw new GitCommandError('Committed candidate diff exceeded the output limit', result);
    }

    return result.stdout;
  }

  async hasUnstagedOrUntrackedChanges(repo) {
    const unstaged = await this.runGit(
      ['diff', '--quiet', '--exit-code', '--'],
      repo,
      { allowFailure: true },
    );

    if (![0, 1].includes(unstaged.exitCode)) {
      throw new GitCommandError('Unable to inspect unstaged candidate changes', unstaged);
    }

    return unstaged.exitCode === 1
      || (await this.getUntrackedFiles(repo)).length > 0;
  }

  async commit(repo, message) {
    await this.runGit(['commit', '-m', message, '--'], repo);
    return this.getHeadCommit(repo);
  }

  async isAncestor(repo, ancestor, descendant) {
    const result = await this.runGit(
      ['merge-base', '--is-ancestor', ancestor, descendant],
      repo,
      { allowFailure: true },
    );

    if (result.exitCode === 0) {
      return true;
    }

    if (result.exitCode === 1) {
      return false;
    }

    throw new GitCommandError('Unable to verify candidate ancestry', result);
  }

  async mergeNoFastForward(repo, candidateCommit) {
    await this.runGit(
      ['merge', '--no-ff', '--no-edit', candidateCommit],
      repo,
    );
    return this.getHeadCommit(repo);
  }

  async abortMerge(repo) {
    return this.runGit(['merge', '--abort'], repo, { allowFailure: true });
  }

  async getOperationState(repo) {
    const mergeResult = await this.runGit(
      ['rev-parse', '-q', '--verify', 'MERGE_HEAD'],
      repo,
      { allowFailure: true },
    );
    const gitPaths = await Promise.all(
      ['rebase-apply', 'rebase-merge'].map(async (name) => {
        const result = await this.runGit(['rev-parse', '--git-path', name], repo);
        const resolvedPath = path.resolve(repo, result.stdout.trim());

        try {
          await fs.access(resolvedPath);
          return true;
        } catch (error) {
          if (error.code === 'ENOENT') {
            return false;
          }

          throw error;
        }
      }),
    );

    return {
      merge: mergeResult.exitCode === 0,
      rebase: gitPaths.some(Boolean),
    };
  }

  async removeWorktree(repo, worktreePath, { force = false } = {}) {
    const args = ['worktree', 'remove'];

    if (force) {
      args.push('--force');
    }

    args.push(worktreePath);
    await this.runGit(args, repo);
  }

  async deleteBranch(repo, branch, { force = false } = {}) {
    await this.runGit(['branch', force ? '-D' : '-d', branch], repo);
  }

  async pruneWorktrees(repo) {
    await this.runGit(['worktree', 'prune'], repo);
  }
}

const gitService = new GitService();

module.exports = {
  GitCommandError,
  GitService,
  RepositoryValidationError,
  gitService,
  parseChangedFiles,
  parseNullDelimitedPaths,
  parseWorktreeList,
};
