const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { config } = require('../config/env');
const { isInsideWorkspace } = require('../utils/workspace-path.util');

const SNAPSHOT_EXCLUSIONS = Object.freeze(new Set([
  '.git',
  'node_modules',
  '.agent-worktrees',
  '.sandbox-runs',
]));

class SandboxSnapshotError extends Error {
  constructor(message, code = 'SANDBOX_SNAPSHOT_FAILED') {
    super(message);
    this.name = 'SandboxSnapshotError';
    this.code = code;
  }
}

function createSandboxId() {
  return crypto.randomUUID().replace(/-/gu, '').slice(0, 16);
}

function validateSandboxId(sandboxId) {
  if (typeof sandboxId !== 'string'
    || !/^[a-f0-9]{12,32}$/u.test(sandboxId)) {
    throw new SandboxSnapshotError(
      'Sandbox ID is invalid.',
      'INVALID_SANDBOX_ID',
    );
  }

  return sandboxId;
}

async function copyEntry({ sourceRoot, destinationRoot, relativePath }) {
  const source = path.resolve(sourceRoot, relativePath);
  const destination = path.resolve(destinationRoot, relativePath);

  if (!isInsideWorkspace(sourceRoot, source)
    || !isInsideWorkspace(destinationRoot, destination)) {
    throw new SandboxSnapshotError(
      'Snapshot path escaped its configured root.',
      'UNSAFE_SNAPSHOT_PATH',
    );
  }

  const entry = await fs.lstat(source);

  if (entry.isSymbolicLink()) {
    throw new SandboxSnapshotError(
      `Symbolic links are not allowed in sandbox snapshots: ${relativePath}`,
      'SNAPSHOT_SYMLINK_REJECTED',
    );
  }

  const realSource = await fs.realpath(source);

  if (!isInsideWorkspace(sourceRoot, realSource)) {
    throw new SandboxSnapshotError(
      `Snapshot source resolves outside the workspace: ${relativePath}`,
      'UNSAFE_SNAPSHOT_PATH',
    );
  }

  if (entry.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    const children = await fs.readdir(source, { withFileTypes: true });

    for (const child of children.sort((left, right) => (
      left.name.localeCompare(right.name)
    ))) {
      if (SNAPSHOT_EXCLUSIONS.has(child.name)) {
        continue;
      }

      await copyEntry({
        sourceRoot,
        destinationRoot,
        relativePath: path.join(relativePath, child.name),
      });
    }

    return;
  }

  if (!entry.isFile()) {
    throw new SandboxSnapshotError(
      `Special filesystem entries are not allowed: ${relativePath}`,
      'SNAPSHOT_SPECIAL_FILE_REJECTED',
    );
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  await fs.chmod(destination, entry.mode & 0o777);
}

class SandboxSnapshotService {
  constructor({
    runRoot = config.sandbox.runRoot,
    keepRuns = config.sandbox.keepRuns,
    cwd = process.cwd(),
    idFactory = createSandboxId,
  } = {}) {
    this.runRoot = path.resolve(cwd, runRoot);
    this.keepRuns = keepRuns;
    this.idFactory = idFactory;
  }

  async create(workspace) {
    const resolvedWorkspace = path.resolve(workspace);
    let sourceRoot;

    try {
      sourceRoot = await fs.realpath(resolvedWorkspace);
    } catch {
      throw new SandboxSnapshotError(
        'Sandbox source workspace does not exist.',
        'SNAPSHOT_WORKSPACE_MISSING',
      );
    }

    const sourceStat = await fs.lstat(sourceRoot);

    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      throw new SandboxSnapshotError(
        'Sandbox source workspace must be a regular directory.',
        'SNAPSHOT_WORKSPACE_INVALID',
      );
    }

    await fs.mkdir(this.runRoot, { recursive: true });
    const realRunRoot = await fs.realpath(this.runRoot);
    const sandboxId = validateSandboxId(this.idFactory());
    const runPath = path.resolve(realRunRoot, sandboxId);
    const snapshotPath = path.join(runPath, 'workspace');

    if (!isInsideWorkspace(realRunRoot, runPath) || runPath === realRunRoot) {
      throw new SandboxSnapshotError(
        'Sandbox run path escaped its configured root.',
        'UNSAFE_SANDBOX_RUN_PATH',
      );
    }

    await fs.mkdir(runPath, { recursive: false });
    await fs.mkdir(snapshotPath, { recursive: false });

    try {
      const children = await fs.readdir(sourceRoot, { withFileTypes: true });

      for (const child of children.sort((left, right) => (
        left.name.localeCompare(right.name)
      ))) {
        if (SNAPSHOT_EXCLUSIONS.has(child.name)) {
          continue;
        }

        await copyEntry({
          sourceRoot,
          destinationRoot: snapshotPath,
          relativePath: child.name,
        });
      }
    } catch (error) {
      await fs.rm(runPath, { recursive: true, force: true });
      throw error;
    }

    return {
      sandboxId,
      source: sourceRoot,
      runRoot: realRunRoot,
      runPath,
      snapshotPath,
    };
  }

  async cleanup(snapshot) {
    if (this.keepRuns) {
      return { removed: false, kept: true };
    }

    const realRunRoot = await fs.realpath(this.runRoot);
    const sandboxId = validateSandboxId(snapshot?.sandboxId);
    const expectedRunPath = path.resolve(realRunRoot, sandboxId);
    const suppliedRunPath = path.resolve(snapshot?.runPath || '');

    if (suppliedRunPath !== expectedRunPath
      || !isInsideWorkspace(realRunRoot, suppliedRunPath)
      || suppliedRunPath === realRunRoot) {
      throw new SandboxSnapshotError(
        'Refusing to clean an unvalidated sandbox run path.',
        'UNSAFE_SANDBOX_CLEANUP',
      );
    }

    await fs.rm(suppliedRunPath, { recursive: true, force: true });
    return { removed: true, kept: false };
  }
}

const sandboxSnapshotService = new SandboxSnapshotService();

module.exports = {
  SNAPSHOT_EXCLUSIONS,
  SandboxSnapshotError,
  SandboxSnapshotService,
  copyEntry,
  createSandboxId,
  sandboxSnapshotService,
  validateSandboxId,
};
