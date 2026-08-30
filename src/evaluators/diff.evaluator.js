const path = require('node:path');

const { evaluatorConfig } = require('../config/evaluator');
const {
  UnsafeWorkspacePathError,
  resolveWorkspaceFile,
} = require('../utils/workspace-path.util');

function normalizeGitPath(filePath) {
  return String(filePath).replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function isDeletedStatus(status) {
  return typeof status === 'string' && status.includes('D');
}

function collectChangedFiles(changedFiles, untrackedFiles) {
  const entries = new Map();
  const allPaths = new Set();

  for (const change of changedFiles || []) {
    if (!change || typeof change.file !== 'string') {
      continue;
    }

    const normalizedPath = normalizeGitPath(change.file);
    allPaths.add(normalizedPath);
    entries.set(normalizedPath, {
      path: normalizedPath,
      status: typeof change.status === 'string' ? change.status : '',
      untracked: change.status === '??',
      deleted: isDeletedStatus(change.status),
    });

    if (typeof change.originalFile === 'string') {
      allPaths.add(normalizeGitPath(change.originalFile));
    }
  }

  for (const untrackedFile of untrackedFiles || []) {
    if (typeof untrackedFile !== 'string') {
      continue;
    }

    const normalizedPath = normalizeGitPath(untrackedFile);
    allPaths.add(normalizedPath);
    entries.set(normalizedPath, {
      path: normalizedPath,
      status: '??',
      untracked: true,
      deleted: false,
    });
  }

  return {
    files: [...entries.values()],
    allPaths: [...allPaths],
  };
}

function findSensitiveFile(filePath, rules) {
  const basename = path.posix.basename(normalizeGitPath(filePath)).toLowerCase();
  const rule = rules.find((candidate) => candidate.matches(basename));

  if (!rule) {
    return null;
  }

  return {
    path: normalizeGitPath(filePath),
    rule: rule.id,
    severity: rule.severity,
  };
}

class DiffEvaluator {
  constructor({
    maxChangedFiles = evaluatorConfig.maxChangedFiles,
    maxDiffBytes = evaluatorConfig.maxDiffBytes,
    sensitiveFileRules = evaluatorConfig.sensitiveFileRules,
  } = {}) {
    this.maxChangedFiles = maxChangedFiles;
    this.maxDiffBytes = maxDiffBytes;
    this.sensitiveFileRules = sensitiveFileRules;
  }

  evaluate({
    workspace,
    changedFiles = [],
    trackedDiff = '',
    untrackedFiles = [],
  }) {
    if (typeof trackedDiff !== 'string') {
      throw new TypeError('trackedDiff must be a string');
    }

    const collected = collectChangedFiles(changedFiles, untrackedFiles);
    const sensitiveFiles = [];
    const unsafePaths = [];

    for (const filePath of collected.allPaths) {
      try {
        resolveWorkspaceFile(workspace, filePath);
      } catch (error) {
        if (!(error instanceof UnsafeWorkspacePathError)) {
          throw error;
        }

        unsafePaths.push({
          path: filePath,
          rule: error.code,
          severity: 'critical',
        });
      }

      const sensitiveFile = findSensitiveFile(
        filePath,
        this.sensitiveFileRules,
      );

      if (sensitiveFile) {
        sensitiveFiles.push(sensitiveFile);
      }
    }

    const changedFileCount = collected.files.length;
    const trackedDiffBytes = Buffer.byteLength(trackedDiff, 'utf8');
    const tooManyFiles = changedFileCount > this.maxChangedFiles;
    const diffTooLarge = trackedDiffBytes > this.maxDiffBytes;

    return {
      changedFileCount,
      trackedDiffBytes,
      maxChangedFiles: this.maxChangedFiles,
      maxDiffBytes: this.maxDiffBytes,
      tooManyFiles,
      diffTooLarge,
      sensitiveFiles,
      unsafePaths,
      untrackedFiles: collected.files
        .filter((file) => file.untracked)
        .map((file) => file.path),
      files: collected.files,
      checks: [
        {
          code: 'CHANGES_PRESENT',
          passed: changedFileCount > 0,
        },
        {
          code: 'CHANGED_FILE_LIMIT',
          passed: !tooManyFiles,
        },
        {
          code: 'TRACKED_DIFF_SIZE',
          passed: !diffTooLarge,
        },
        {
          code: 'SENSITIVE_FILES',
          passed: sensitiveFiles.length === 0,
        },
        {
          code: 'CHANGED_PATH_SAFETY',
          passed: unsafePaths.length === 0,
        },
      ],
    };
  }
}

const diffEvaluator = new DiffEvaluator();

module.exports = {
  DiffEvaluator,
  collectChangedFiles,
  diffEvaluator,
  findSensitiveFile,
  isDeletedStatus,
  normalizeGitPath,
};
