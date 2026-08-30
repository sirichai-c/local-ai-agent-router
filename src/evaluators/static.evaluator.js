const fs = require('node:fs/promises');
const path = require('node:path');

const { evaluatorConfig } = require('../config/evaluator');
const { processRunnerService } = require('../services/process-runner.service');
const {
  UnsafeWorkspacePathError,
  isInsideWorkspace,
  resolveWorkspaceFile,
} = require('../utils/workspace-path.util');

const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const STATIC_CHECK_TIMEOUT_MS = 30_000;
const STATIC_CHECK_OUTPUT_BYTES = 64 * 1024;

function sanitizeJavaScriptDiagnostic(result) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  const syntaxLine = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^SyntaxError:/u.test(line));

  return (syntaxLine || 'JavaScript syntax check failed.').slice(0, 1_000);
}

function createSkippedCheck(file, reason, type = 'not-applicable') {
  return {
    file: file.path,
    type,
    applicable: type !== 'not-applicable',
    executed: false,
    passed: null,
    skipped: true,
    reason,
  };
}

class StaticEvaluator {
  constructor({
    runner = processRunnerService,
    nodeCommand = process.execPath,
    maxFileBytes = evaluatorConfig.maxDiffBytes,
    stat = fs.lstat,
    realpath = fs.realpath,
    readFile = fs.readFile,
  } = {}) {
    this.runner = runner;
    this.nodeCommand = nodeCommand;
    this.maxFileBytes = maxFileBytes;
    this.stat = stat;
    this.realpath = realpath;
    this.readFile = readFile;
  }

  async evaluateFile(workspace, file) {
    const extension = path.extname(file.path).toLowerCase();
    const checkType = JAVASCRIPT_EXTENSIONS.has(extension)
      ? 'javascript-syntax'
      : extension === '.json' ? 'json-parse' : null;

    if (file.deleted) {
      return createSkippedCheck(file, 'deleted', checkType || 'not-applicable');
    }

    if (!checkType) {
      return createSkippedCheck(file, 'unsupported file type');
    }

    let resolvedPath;

    try {
      resolvedPath = resolveWorkspaceFile(workspace, file.path);
    } catch (error) {
      if (!(error instanceof UnsafeWorkspacePathError)) {
        throw error;
      }

      return {
        file: file.path,
        type: 'path-safety',
        applicable: true,
        executed: false,
        passed: false,
        hardFail: true,
        code: error.code,
        message: error.message,
      };
    }

    let fileStat;

    try {
      fileStat = await this.stat(resolvedPath);
    } catch (error) {
      return {
        file: file.path,
        type: checkType,
        applicable: true,
        executed: false,
        passed: false,
        code: error.code === 'ENOENT' ? 'CHANGED_FILE_MISSING' : 'FILE_INACCESSIBLE',
        message: 'Changed file could not be inspected.',
      };
    }

    if (fileStat.isSymbolicLink()) {
      return {
        file: file.path,
        type: 'path-safety',
        applicable: true,
        executed: false,
        passed: false,
        hardFail: true,
        code: 'SYMLINK_NOT_ALLOWED',
        message: 'Changed symbolic links are not followed by the evaluator.',
      };
    }

    let realWorkspace;
    let realFilePath;

    try {
      [realWorkspace, realFilePath] = await Promise.all([
        this.realpath(path.resolve(workspace)),
        this.realpath(resolvedPath),
      ]);
    } catch {
      return {
        file: file.path,
        type: 'path-safety',
        applicable: true,
        executed: false,
        passed: false,
        hardFail: true,
        code: 'REAL_PATH_UNAVAILABLE',
        message: 'Changed file real path could not be verified safely.',
      };
    }

    if (!isInsideWorkspace(realWorkspace, realFilePath)
      || realFilePath === realWorkspace) {
      return {
        file: file.path,
        type: 'path-safety',
        applicable: true,
        executed: false,
        passed: false,
        hardFail: true,
        code: 'REAL_PATH_OUTSIDE_WORKSPACE',
        message: 'Changed file resolves outside the real evaluator workspace.',
      };
    }

    if (!fileStat.isFile()) {
      return {
        file: file.path,
        type: checkType,
        applicable: true,
        executed: false,
        passed: false,
        code: 'CHANGED_PATH_NOT_FILE',
        message: 'Changed path is not a regular file.',
      };
    }

    if (fileStat.size > this.maxFileBytes) {
      return {
        file: file.path,
        type: checkType,
        applicable: true,
        executed: false,
        passed: false,
        code: 'STATIC_FILE_TOO_LARGE',
        message: 'Changed file exceeds the static validation size limit.',
      };
    }

    if (checkType === 'json-parse') {
      try {
        JSON.parse(await this.readFile(resolvedPath, 'utf8'));
        return {
          file: file.path,
          type: checkType,
          applicable: true,
          executed: true,
          passed: true,
          message: null,
        };
      } catch {
        return {
          file: file.path,
          type: checkType,
          applicable: true,
          executed: true,
          passed: false,
          code: 'INVALID_JSON',
          message: 'File is not valid JSON.',
        };
      }
    }

    const result = await this.runner.runProcess({
      command: this.nodeCommand,
      args: ['--check', resolvedPath],
      cwd: path.resolve(workspace),
      env: {},
      timeoutMs: STATIC_CHECK_TIMEOUT_MS,
      maxOutputBytes: STATIC_CHECK_OUTPUT_BYTES,
    });
    const passed = result.exitCode === 0 && !result.timedOut;

    return {
      file: file.path,
      type: checkType,
      applicable: true,
      executed: true,
      passed,
      code: passed ? null : 'INVALID_JAVASCRIPT_SYNTAX',
      message: passed ? null : sanitizeJavaScriptDiagnostic(result),
    };
  }

  async evaluate({ workspace, changedFiles = [] }) {
    const checks = [];

    for (const file of changedFiles) {
      checks.push(await this.evaluateFile(workspace, file));
    }

    return checks;
  }
}

const staticEvaluator = new StaticEvaluator();

module.exports = {
  JAVASCRIPT_EXTENSIONS,
  StaticEvaluator,
  createSkippedCheck,
  sanitizeJavaScriptDiagnostic,
  staticEvaluator,
};
