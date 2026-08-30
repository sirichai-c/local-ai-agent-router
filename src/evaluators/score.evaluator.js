const SCORE_DEDUCTIONS = Object.freeze({
  processFailure: 35,
  timeout: 40,
  unexpectedCommit: 30,
  noChanges: 20,
  sensitiveFile: 50,
  tooManyFiles: 20,
  diffTooLarge: 15,
  staticCheckFailure: 20,
  invalidPackageJson: 30,
  projectCheckFailure: 20,
  outputTruncated: 5,
});

function clampScore(score) {
  return Math.max(0, Math.min(100, score));
}

function addReason(reasons, code, impact = 0, details = {}) {
  reasons.push({ code, impact, ...details });
}

class ScoreEvaluator {
  evaluate({
    execution = {},
    diff = {},
    staticChecks = [],
    project = {},
    unexpectedCommit = false,
  }) {
    const reasons = [];
    const hardFailCodes = [];
    let score = 100;

    const deduct = (code, amount, details = {}) => {
      score -= amount;
      addReason(reasons, code, -amount, details);
    };

    const processFailed = execution.exitCode !== 0;
    if (processFailed) {
      deduct('AGENT_PROCESS_FAILED', SCORE_DEDUCTIONS.processFailure);
    } else {
      addReason(reasons, 'AGENT_EXIT_OK');
    }

    if (execution.timedOut) {
      deduct('AGENT_TIMEOUT', SCORE_DEDUCTIONS.timeout);
      hardFailCodes.push('AGENT_TIMEOUT');
    }

    if (unexpectedCommit) {
      deduct('UNEXPECTED_AGENT_COMMIT', SCORE_DEDUCTIONS.unexpectedCommit);
      hardFailCodes.push('UNEXPECTED_AGENT_COMMIT');
    }

    if ((diff.changedFileCount || 0) === 0) {
      deduct('NO_CHANGES', SCORE_DEDUCTIONS.noChanges);
    } else {
      addReason(reasons, 'CHANGES_PRESENT');
    }

    for (const sensitiveFile of diff.sensitiveFiles || []) {
      deduct('SENSITIVE_FILE_MODIFIED', SCORE_DEDUCTIONS.sensitiveFile, {
        file: sensitiveFile.path,
        rule: sensitiveFile.rule,
      });
      hardFailCodes.push('SENSITIVE_FILE_MODIFIED');
    }

    for (const unsafePath of diff.unsafePaths || []) {
      addReason(reasons, 'UNSAFE_CHANGED_PATH', 0, {
        file: unsafePath.path,
      });
      hardFailCodes.push('UNSAFE_CHANGED_PATH');
    }

    if (diff.tooManyFiles) {
      deduct('CHANGED_FILE_LIMIT_EXCEEDED', SCORE_DEDUCTIONS.tooManyFiles, {
        changedFileCount: diff.changedFileCount,
        limit: diff.maxChangedFiles,
      });
    }

    if (diff.diffTooLarge) {
      deduct('TRACKED_DIFF_TOO_LARGE', SCORE_DEDUCTIONS.diffTooLarge, {
        trackedDiffBytes: diff.trackedDiffBytes,
        limit: diff.maxDiffBytes,
      });
    }

    const failedStaticChecks = staticChecks.filter((check) => check.passed === false);
    for (const check of failedStaticChecks) {
      deduct('STATIC_CHECK_FAILED', SCORE_DEDUCTIONS.staticCheckFailure, {
        file: check.file,
        type: check.type,
        checkCode: check.code || null,
      });

      if (check.hardFail) {
        hardFailCodes.push(check.code || 'UNSAFE_STATIC_CHECK');
      }
    }

    if (failedStaticChecks.length === 0) {
      addReason(reasons, 'STATIC_CHECKS_OK');
    }

    if (project.packageJson?.exists && project.packageJson.valid === false) {
      deduct('INVALID_PACKAGE_JSON', SCORE_DEDUCTIONS.invalidPackageJson);
    }

    for (const [script, result] of Object.entries(project.scripts || {})) {
      if (result.executed && result.passed === false) {
        deduct('PROJECT_CHECK_FAILED', SCORE_DEDUCTIONS.projectCheckFailure, {
          script,
        });
      } else if (result.available && !result.executed) {
        addReason(reasons, 'PROJECT_CHECK_SKIPPED', 0, {
          script,
          message: result.reason,
        });
      }
    }

    if (execution.outputTruncated) {
      deduct('AGENT_OUTPUT_TRUNCATED', SCORE_DEDUCTIONS.outputTruncated);
    }

    score = clampScore(score);
    const hardFail = hardFailCodes.length > 0;
    const staticValidationFailed = failedStaticChecks.length > 0;
    let verdict;

    if (hardFail || staticValidationFailed) {
      verdict = 'fail';
    } else if (score >= 90) {
      verdict = 'pass';
    } else if (score >= 70) {
      verdict = 'warning';
    } else {
      verdict = 'fail';
    }

    return {
      score,
      verdict,
      hardFail,
      hardFailCodes: [...new Set(hardFailCodes)],
      reasons,
    };
  }
}

const scoreEvaluator = new ScoreEvaluator();

module.exports = {
  SCORE_DEDUCTIONS,
  ScoreEvaluator,
  clampScore,
  scoreEvaluator,
};
