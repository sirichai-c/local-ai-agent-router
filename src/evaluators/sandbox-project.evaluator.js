const fs = require('node:fs/promises');
const path = require('node:path');

const { config } = require('../config/env');
const { sandboxService } = require('../services/sandbox.service');
const {
  sandboxSnapshotService,
} = require('../services/sandbox-snapshot.service');

const SCRIPT_ORDER = Object.freeze(['test', 'lint', 'build']);

function processSucceeded(result) {
  return result.exitCode === 0 && !result.timedOut;
}

function toExecutionResult(type, result) {
  const passed = processSucceeded(result);

  return {
    type,
    available: true,
    executed: true,
    sandbox: true,
    network: result.network,
    passed,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    outputTruncated: result.outputTruncated,
    stdout: result.stdout,
    stderr: result.stderr,
    reason: passed ? null : (result.timedOut ? 'sandbox_timeout' : 'project_check_failed'),
  };
}

function createSkippedScript(available, reason) {
  return {
    available,
    executed: false,
    sandbox: true,
    network: 'none',
    passed: null,
    ...(available && reason ? { reason } : {}),
  };
}

function reportSandboxEvent(onEvent, type, data, status = 'running') {
  if (typeof onEvent !== 'function') return;

  try {
    onEvent({
      type,
      stage: 'evaluation',
      status,
      messageKey: type === 'sandbox_check_started'
        ? 'run.sandboxCheckStarted'
        : 'run.sandboxCheckCompleted',
      data,
    });
  } catch {
    // Optional observability cannot alter sandbox evaluation.
  }
}

class SandboxProjectEvaluator {
  constructor({
    snapshots = sandboxSnapshotService,
    sandbox = sandboxService,
    installDependencies = config.sandbox.installDependencies,
    installTimeoutMs = config.sandbox.installTimeoutMs,
    timeoutMs = config.sandbox.timeoutMs,
    access = fs.access,
  } = {}) {
    this.snapshots = snapshots;
    this.sandbox = sandbox;
    this.installDependencies = installDependencies;
    this.installTimeoutMs = installTimeoutMs;
    this.timeoutMs = timeoutMs;
    this.access = access;
  }

  async hasLockFile(snapshotPath) {
    try {
      await this.access(path.join(snapshotPath, 'package-lock.json'));
      return true;
    } catch {
      return false;
    }
  }

  async install(snapshot) {
    if (!this.installDependencies) {
      return {
        required: false,
        executed: false,
        passed: null,
        reason: 'dependency_install_disabled',
      };
    }

    const installCommand = await this.hasLockFile(snapshot.snapshotPath)
      ? 'ci'
      : 'install';
    const result = await this.sandbox.run({
      sandboxId: snapshot.sandboxId,
      snapshotPath: snapshot.snapshotPath,
      command: 'npm',
      args: [installCommand, '--ignore-scripts', '--no-audit', '--no-fund'],
      network: 'bridge',
      timeoutMs: this.installTimeoutMs,
      purpose: 'dependency-install',
    });

    return {
      required: true,
      command: `npm ${installCommand}`,
      executed: true,
      sandbox: true,
      network: 'bridge',
      passed: processSucceeded(result),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      outputTruncated: result.outputTruncated,
      stdout: result.stdout,
      stderr: result.stderr,
      reason: processSucceeded(result)
        ? null
        : (result.timedOut ? 'dependency_install_timeout' : 'dependency_install_failed'),
    };
  }

  async runScript(snapshot, scriptName) {
    const args = scriptName === 'test'
      ? ['test']
      : ['run', scriptName];
    const result = await this.sandbox.run({
      sandboxId: snapshot.sandboxId,
      snapshotPath: snapshot.snapshotPath,
      command: 'npm',
      args,
      network: 'none',
      timeoutMs: this.timeoutMs,
      purpose: scriptName,
    });

    return toExecutionResult(`npm-${scriptName}`, result);
  }

  async evaluate({ workspace, scripts = {}, onEvent }) {
    const availableScripts = Object.fromEntries(SCRIPT_ORDER.map((name) => [
      name,
      typeof scripts[name] === 'string' && scripts[name].trim() !== '',
    ]));

    if (!Object.values(availableScripts).some(Boolean)) {
      return {
        sandbox: { requested: true, executed: false },
        dependencyInstall: {
          required: false,
          executed: false,
          passed: null,
          reason: 'no_project_scripts',
        },
        scripts: Object.fromEntries(SCRIPT_ORDER.map((name) => [
          name,
          createSkippedScript(false),
        ])),
      };
    }

    const availability = await this.sandbox.inspectAvailability();

    if (!availability.available) {
      return {
        sandbox: {
          requested: true,
          executed: false,
          image: availability.image,
          reason: availability.reason,
        },
        dependencyInstall: {
          required: this.installDependencies,
          executed: false,
          passed: null,
          reason: availability.reason,
        },
        scripts: Object.fromEntries(SCRIPT_ORDER.map((name) => [
          name,
          createSkippedScript(availableScripts[name], availability.reason),
        ])),
      };
    }

    let snapshot;

    try {
      snapshot = await this.snapshots.create(workspace);
      if (this.installDependencies) {
        reportSandboxEvent(onEvent, 'sandbox_check_started', {
          check: 'dependency-install',
          network: 'bridge',
        });
      }
      const dependencyInstall = await this.install(snapshot);
      if (this.installDependencies) {
        reportSandboxEvent(onEvent, 'sandbox_check_completed', {
          check: 'dependency-install',
          network: dependencyInstall.network || 'bridge',
          executed: dependencyInstall.executed,
          passed: dependencyInstall.passed,
          timedOut: dependencyInstall.timedOut === true,
        }, dependencyInstall.passed === false ? 'failed' : 'completed');
      }
      const scriptResults = {};

      for (const scriptName of SCRIPT_ORDER) {
        if (!availableScripts[scriptName]) {
          scriptResults[scriptName] = createSkippedScript(false);
          continue;
        }

        if (dependencyInstall.executed && dependencyInstall.passed === false) {
          scriptResults[scriptName] = createSkippedScript(
            true,
            'dependency_install_failed',
          );
          continue;
        }

        reportSandboxEvent(onEvent, 'sandbox_check_started', {
          check: scriptName,
          network: 'none',
        });
        scriptResults[scriptName] = await this.runScript(snapshot, scriptName);
        reportSandboxEvent(onEvent, 'sandbox_check_completed', {
          check: scriptName,
          network: scriptResults[scriptName].network,
          executed: true,
          passed: scriptResults[scriptName].passed,
          timedOut: scriptResults[scriptName].timedOut,
        }, scriptResults[scriptName].passed ? 'completed' : 'failed');
      }

      return {
        sandbox: {
          requested: true,
          executed: true,
          image: availability.image,
          sandboxId: snapshot.sandboxId,
          sourceMutated: false,
        },
        dependencyInstall,
        scripts: scriptResults,
      };
    } catch (error) {
      return {
        sandbox: {
          requested: true,
          executed: false,
          image: availability.image,
          reason: error.code || 'sandbox_setup_failed',
        },
        dependencyInstall: {
          required: this.installDependencies,
          executed: false,
          passed: null,
          reason: error.code || 'sandbox_setup_failed',
        },
        scripts: Object.fromEntries(SCRIPT_ORDER.map((name) => [
          name,
          createSkippedScript(
            availableScripts[name],
            error.code || 'sandbox_setup_failed',
          ),
        ])),
      };
    } finally {
      if (snapshot) {
        try {
          await this.snapshots.cleanup(snapshot);
        } catch {
          // Snapshot cleanup state is reported through the run-root audit.
        }
      }
    }
  }
}

const sandboxProjectEvaluator = new SandboxProjectEvaluator();

module.exports = {
  SCRIPT_ORDER,
  SandboxProjectEvaluator,
  createSkippedScript,
  processSucceeded,
  sandboxProjectEvaluator,
  toExecutionResult,
  reportSandboxEvent,
};
