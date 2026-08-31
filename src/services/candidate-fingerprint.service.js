const crypto = require('node:crypto');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const { gitService } = require('./git.service');
const {
  isInsideWorkspace,
  resolveWorkspaceFile,
} = require('../utils/workspace-path.util');

class CandidateFingerprintError extends Error {
  constructor(message, code = 'CANDIDATE_FINGERPRINT_FAILED') {
    super(message);
    this.name = 'CandidateFingerprintError';
    this.code = code;
  }
}

function normalizeGitPath(filePath) {
  return filePath.replace(/\\/gu, '/');
}

function updateHash(hash, label, value) {
  const labelBuffer = Buffer.from(label, 'utf8');
  const valueBuffer = Buffer.from(String(value), 'utf8');

  hash.update(String(labelBuffer.length));
  hash.update(':');
  hash.update(labelBuffer);
  hash.update(String(valueBuffer.length));
  hash.update(':');
  hash.update(valueBuffer);
}

function semanticStatus(status) {
  if (status === '??') {
    return 'A';
  }

  for (const candidate of ['U', 'D', 'R', 'C', 'A', 'M', 'T']) {
    if (status.includes(candidate)) {
      return candidate;
    }
  }

  return status.trim() || 'UNKNOWN';
}

function normalizeChangedFiles(changedFiles) {
  return changedFiles
    .map((change) => ({
      status: change.status,
      semanticStatus: semanticStatus(change.status),
      file: normalizeGitPath(change.file),
      originalFile: change.originalFile
        ? normalizeGitPath(change.originalFile)
        : null,
    }))
    .sort((left, right) => (
      left.file.localeCompare(right.file)
      || left.status.localeCompare(right.status)
      || (left.originalFile || '').localeCompare(right.originalFile || '')
    ));
}

async function hashRegularFile(workspace, relativePath) {
  const resolvedWorkspace = await fsPromises.realpath(path.resolve(workspace));
  const resolvedPath = resolveWorkspaceFile(resolvedWorkspace, relativePath);
  const entry = await fsPromises.lstat(resolvedPath);

  if (entry.isSymbolicLink()) {
    throw new CandidateFingerprintError(
      `Candidate path is a symbolic link: ${relativePath}`,
      'UNSAFE_CANDIDATE_PATH',
    );
  }

  const realPath = await fsPromises.realpath(resolvedPath);

  if (!isInsideWorkspace(resolvedWorkspace, realPath)) {
    throw new CandidateFingerprintError(
      `Candidate path resolves outside the worktree: ${relativePath}`,
      'UNSAFE_CANDIDATE_PATH',
    );
  }

  const handle = await fsPromises.open(realPath, 'r');

  try {
    const before = await handle.stat();

    if (!before.isFile()) {
      throw new CandidateFingerprintError(
        `Candidate path is not a regular file: ${relativePath}`,
        'UNSAFE_CANDIDATE_PATH',
      );
    }

    const hash = crypto.createHash('sha256');
    const stream = handle.createReadStream({
      autoClose: false,
    });

    for await (const chunk of stream) {
      hash.update(chunk);
    }

    const after = await handle.stat();

    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new CandidateFingerprintError(
        `Candidate file changed while it was being fingerprinted: ${relativePath}`,
        'CANDIDATE_CHANGED_DURING_FINGERPRINT',
      );
    }

    return {
      digest: hash.digest('hex'),
      mode: after.mode,
      size: after.size,
    };
  } finally {
    await handle.close();
  }
}

class CandidateFingerprintService {
  constructor({ git = gitService } = {}) {
    this.git = git;
  }

  async capture({ workspace, baseCommit }) {
    if (typeof workspace !== 'string' || workspace.trim() === '') {
      throw new TypeError('workspace must be a non-empty string');
    }

    if (typeof baseCommit !== 'string' || baseCommit.trim() === '') {
      throw new TypeError('baseCommit must be a non-empty string');
    }

    const [headCommit, status, changedFiles, diffResult, untrackedFiles] = (
      await Promise.all([
        this.git.getHeadCommit(workspace),
        this.git.getStatus(workspace),
        this.git.getChangedFiles(workspace),
        this.git.getDiffResult(workspace),
        this.git.getUntrackedFiles(workspace),
      ])
    );

    if (diffResult.outputTruncated) {
      throw new CandidateFingerprintError(
        'Candidate tracked diff exceeded the safe fingerprint output limit',
        'CANDIDATE_DIFF_TOO_LARGE',
      );
    }

    const trackedDiff = diffResult.stdout;
    const normalizedChanges = normalizeChangedFiles(changedFiles);
    const normalizedUntracked = [...new Set(
      untrackedFiles.map(normalizeGitPath),
    )].sort((left, right) => left.localeCompare(right));
    const untrackedContent = [];

    for (const relativePath of normalizedUntracked) {
      untrackedContent.push({
        path: relativePath,
        ...await hashRegularFile(workspace, relativePath),
      });
    }

    const snapshotFiles = [];

    for (const change of normalizedChanges) {
      if (change.semanticStatus === 'D') {
        snapshotFiles.push({
          path: change.file,
          status: change.semanticStatus,
          deleted: true,
        });
        continue;
      }

      snapshotFiles.push({
        path: change.file,
        status: change.semanticStatus,
        deleted: false,
        ...await hashRegularFile(workspace, change.file),
      });
    }

    const fingerprintHash = crypto.createHash('sha256');
    updateHash(fingerprintHash, 'baseCommit', baseCommit);
    updateHash(fingerprintHash, 'headCommit', headCommit);
    updateHash(fingerprintHash, 'status', JSON.stringify(normalizedChanges));
    updateHash(fingerprintHash, 'trackedDiff', trackedDiff);
    updateHash(
      fingerprintHash,
      'untrackedPaths',
      JSON.stringify(normalizedUntracked),
    );
    updateHash(
      fingerprintHash,
      'untrackedContents',
      JSON.stringify(untrackedContent),
    );

    const snapshotHash = crypto.createHash('sha256');
    updateHash(snapshotHash, 'baseCommit', baseCommit);
    updateHash(snapshotHash, 'headCommit', headCommit);
    updateHash(snapshotHash, 'files', JSON.stringify(snapshotFiles));

    return {
      fingerprint: `sha256:${fingerprintHash.digest('hex')}`,
      snapshotFingerprint: `sha256:${snapshotHash.digest('hex')}`,
      headCommit,
      status,
      changedFiles,
      normalizedChanges,
      trackedDiff,
      untrackedFiles: normalizedUntracked,
      hasChanges: normalizedChanges.length > 0,
    };
  }
}

const candidateFingerprintService = new CandidateFingerprintService();

module.exports = {
  CandidateFingerprintError,
  CandidateFingerprintService,
  candidateFingerprintService,
  hashRegularFile,
  normalizeChangedFiles,
  semanticStatus,
  updateHash,
};
