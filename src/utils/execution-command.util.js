const fs = require('node:fs/promises');
const path = require('node:path');

async function isFile(candidatePath, statImpl = fs.stat) {
  try {
    return (await statImpl(candidatePath)).isFile();
  } catch {
    return false;
  }
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((candidate) => path.resolve(candidate)))];
}

async function resolveExecutionCommand(agent, detection, {
  platform = process.platform,
  nodeExecutable = process.execPath,
  statImpl = fs.stat,
} = {}) {
  if (!detection?.exists || !detection.path) {
    return null;
  }

  if (platform !== 'win32') {
    return {
      command: detection.path,
      args: [],
    };
  }

  const detectedPaths = uniquePaths([
    detection.path,
    ...(detection.paths || []),
  ]);
  const nativeCandidates = detectedPaths.filter(
    (candidate) => path.extname(candidate).toLowerCase() === '.exe',
  );
  const relativeNativePath = agent.execution?.windows
    ?.nativeExecutableRelativePath;

  if (relativeNativePath) {
    nativeCandidates.push(...detectedPaths.map((candidate) => (
      path.resolve(path.dirname(candidate), relativeNativePath)
    )));
  }

  for (const candidate of uniquePaths(nativeCandidates)) {
    if (await isFile(candidate, statImpl)) {
      return {
        command: candidate,
        args: [],
      };
    }
  }

  const nodeEntryRelativePath = agent.execution?.windows?.nodeEntryRelativePath;

  if (nodeEntryRelativePath && await isFile(nodeExecutable, statImpl)) {
    const nodeEntryCandidates = detectedPaths.map((candidate) => (
      path.resolve(path.dirname(candidate), nodeEntryRelativePath)
    ));

    for (const candidate of uniquePaths(nodeEntryCandidates)) {
      if (await isFile(candidate, statImpl)) {
        return {
          command: path.resolve(nodeExecutable),
          args: [candidate],
        };
      }
    }
  }

  return null;
}

module.exports = {
  resolveExecutionCommand,
};
