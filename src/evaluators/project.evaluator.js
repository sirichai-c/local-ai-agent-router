const fs = require('node:fs/promises');

const { evaluatorConfig } = require('../config/evaluator');
const { resolveWorkspaceFile } = require('../utils/workspace-path.util');

const PROJECT_SCRIPT_NAMES = Object.freeze(['test', 'lint', 'build']);
const SCRIPT_DISABLED_REASON = 'Project script execution disabled until sandboxing is available.';
const SCRIPT_UNSUPPORTED_REASON = 'Host project script execution is unavailable in Phase 7; use the Phase 11A sandbox.';

function createScriptResult(available, reason) {
  return {
    available,
    executed: false,
    passed: null,
    ...(reason ? { reason } : {}),
  };
}

class ProjectEvaluator {
  constructor({
    runProjectScripts = evaluatorConfig.runProjectScripts,
    maxPackageBytes = evaluatorConfig.maxDiffBytes,
    stat = fs.lstat,
    readFile = fs.readFile,
  } = {}) {
    this.runProjectScripts = runProjectScripts;
    this.maxPackageBytes = maxPackageBytes;
    this.stat = stat;
    this.readFile = readFile;
  }

  createScripts(packageScripts = {}) {
    return Object.fromEntries(PROJECT_SCRIPT_NAMES.map((scriptName) => {
      const available = typeof packageScripts[scriptName] === 'string'
        && packageScripts[scriptName].trim() !== '';
      let reason;

      if (available) {
        reason = this.runProjectScripts
          ? SCRIPT_UNSUPPORTED_REASON
          : SCRIPT_DISABLED_REASON;
      }

      return [scriptName, createScriptResult(available, reason)];
    }));
  }

  async evaluate({ workspace }) {
    const packagePath = resolveWorkspaceFile(workspace, 'package.json');
    let packageStat;

    try {
      packageStat = await this.stat(packagePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          projectType: 'unknown',
          packageJson: { exists: false, valid: null },
          scriptExecutionPolicy: {
            requested: this.runProjectScripts,
            supported: false,
          },
          scripts: this.createScripts(),
        };
      }

      throw error;
    }

    if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
      return {
        projectType: 'node',
        packageJson: {
          exists: true,
          valid: false,
          error: 'package.json must be a regular file inside the workspace.',
        },
        scriptExecutionPolicy: {
          requested: this.runProjectScripts,
          supported: false,
        },
        scripts: this.createScripts(),
      };
    }

    if (packageStat.size > this.maxPackageBytes) {
      return {
        projectType: 'node',
        packageJson: {
          exists: true,
          valid: false,
          error: 'package.json exceeds the evaluator size limit.',
        },
        scriptExecutionPolicy: {
          requested: this.runProjectScripts,
          supported: false,
        },
        scripts: this.createScripts(),
      };
    }

    let packageJson;

    try {
      packageJson = JSON.parse(await this.readFile(packagePath, 'utf8'));
    } catch {
      return {
        projectType: 'node',
        packageJson: {
          exists: true,
          valid: false,
          error: 'package.json is not valid JSON.',
        },
        scriptExecutionPolicy: {
          requested: this.runProjectScripts,
          supported: false,
        },
        scripts: this.createScripts(),
      };
    }

    return {
      projectType: 'node',
      packageJson: { exists: true, valid: true },
      scriptExecutionPolicy: {
        requested: this.runProjectScripts,
        supported: false,
      },
      scripts: this.createScripts(packageJson.scripts),
    };
  }
}

const projectEvaluator = new ProjectEvaluator();

module.exports = {
  PROJECT_SCRIPT_NAMES,
  ProjectEvaluator,
  SCRIPT_DISABLED_REASON,
  SCRIPT_UNSUPPORTED_REASON,
  projectEvaluator,
};
