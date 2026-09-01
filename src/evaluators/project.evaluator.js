const fs = require('node:fs/promises');

const { evaluatorConfig } = require('../config/evaluator');
const { config } = require('../config/env');
const { resolveWorkspaceFile } = require('../utils/workspace-path.util');
const {
  sandboxProjectEvaluator,
} = require('./sandbox-project.evaluator');

const PROJECT_SCRIPT_NAMES = Object.freeze(['test', 'lint', 'build']);
const SCRIPT_DISABLED_REASON = 'Project script execution disabled until sandboxing is available.';
const SCRIPT_UNSUPPORTED_REASON = 'Project scripts require the Phase 11A Docker sandbox.';

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
    sandbox = sandboxProjectEvaluator,
    sandboxEnabled = config.sandbox.enabled,
  } = {}) {
    this.runProjectScripts = runProjectScripts;
    this.maxPackageBytes = maxPackageBytes;
    this.stat = stat;
    this.readFile = readFile;
    this.sandbox = sandbox;
    this.sandboxEnabled = sandboxEnabled;
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

  async evaluate({ workspace, onEvent }) {
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

    const result = {
      projectType: 'node',
      packageJson: { exists: true, valid: true },
      scriptExecutionPolicy: {
        requested: this.runProjectScripts,
        supported: this.runProjectScripts && this.sandboxEnabled,
        hostExecution: false,
      },
      scripts: this.createScripts(packageJson.scripts),
    };

    if (!this.runProjectScripts) {
      return result;
    }

    if (!this.sandboxEnabled) {
      return result;
    }

    const sandboxResult = await this.sandbox.evaluate({
      workspace,
      scripts: packageJson.scripts || {},
      onEvent,
    });

    return {
      ...result,
      scriptExecutionPolicy: {
        requested: true,
        supported: true,
        hostExecution: false,
        sandbox: true,
      },
      sandbox: sandboxResult.sandbox,
      dependencyInstall: sandboxResult.dependencyInstall,
      scripts: sandboxResult.scripts,
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
