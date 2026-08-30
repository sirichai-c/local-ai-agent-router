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
    const result = await this.runGit(
      ['diff', '--no-ext-diff', 'HEAD', '--'],
      repo,
    );
    return result.stdout;
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
}

const gitService = new GitService();

module.exports = {
  GitCommandError,
  GitService,
  RepositoryValidationError,
  gitService,
  parseChangedFiles,
  parseNullDelimitedPaths,
};
