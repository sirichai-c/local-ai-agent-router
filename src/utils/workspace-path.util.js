const path = require('node:path');

class UnsafeWorkspacePathError extends Error {
  constructor(relativePath) {
    super('Changed file path resolves outside the evaluator workspace');
    this.name = 'UnsafeWorkspacePathError';
    this.code = 'UNSAFE_WORKSPACE_PATH';
    this.relativePath = relativePath;
  }
}

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new UnsafeWorkspacePathError(relativePath);
  }

  if (relativePath.includes('\0')) {
    throw new UnsafeWorkspacePathError(relativePath);
  }

  return relativePath.replace(/[\\/]+/gu, path.sep);
}

function isInsideWorkspace(workspace, candidatePath) {
  const relative = path.relative(workspace, candidatePath);
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkspaceFile(workspace, relativePath) {
  if (typeof workspace !== 'string' || workspace.trim() === '') {
    throw new TypeError('workspace must be a non-empty string');
  }

  const resolvedWorkspace = path.resolve(workspace);
  const normalizedPath = normalizeRelativePath(relativePath);

  if (path.isAbsolute(normalizedPath) || path.win32.isAbsolute(relativePath)) {
    throw new UnsafeWorkspacePathError(relativePath);
  }

  const resolvedPath = path.resolve(resolvedWorkspace, normalizedPath);

  if (!isInsideWorkspace(resolvedWorkspace, resolvedPath)
    || resolvedPath === resolvedWorkspace) {
    throw new UnsafeWorkspacePathError(relativePath);
  }

  return resolvedPath;
}

module.exports = {
  UnsafeWorkspacePathError,
  isInsideWorkspace,
  normalizeRelativePath,
  resolveWorkspaceFile,
};
