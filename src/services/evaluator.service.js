const { diffEvaluator } = require('../evaluators/diff.evaluator');
const { projectEvaluator } = require('../evaluators/project.evaluator');
const { scoreEvaluator } = require('../evaluators/score.evaluator');
const { staticEvaluator } = require('../evaluators/static.evaluator');
const { gitService } = require('./git.service');

class EvaluatorService {
  constructor({
    diff = diffEvaluator,
    staticChecks = staticEvaluator,
    project = projectEvaluator,
    scorer = scoreEvaluator,
    untrackedFileProvider = (workspace) => gitService.getUntrackedFiles(workspace),
  } = {}) {
    this.diff = diff;
    this.staticChecks = staticChecks;
    this.project = project;
    this.scorer = scorer;
    this.untrackedFileProvider = untrackedFileProvider;
  }

  async evaluateAgentResult({
    workspace,
    execution,
    baseCommit,
    changedFiles = [],
    trackedDiff = '',
    untrackedFiles,
    unexpectedCommit = false,
  }) {
    if (typeof workspace !== 'string' || workspace.trim() === '') {
      throw new TypeError('workspace must be a non-empty string');
    }

    const resolvedUntrackedFiles = untrackedFiles
      ?? await this.untrackedFileProvider(workspace);
    const diffResult = this.diff.evaluate({
      workspace,
      changedFiles,
      trackedDiff,
      untrackedFiles: resolvedUntrackedFiles,
    });
    const staticCheckResults = await this.staticChecks.evaluate({
      workspace,
      changedFiles: diffResult.files,
    });
    const projectResult = await this.project.evaluate({ workspace });
    const scoreResult = this.scorer.evaluate({
      execution,
      diff: diffResult,
      staticChecks: staticCheckResults,
      project: projectResult,
      unexpectedCommit,
    });
    const applicableStaticChecks = staticCheckResults.filter(
      (check) => check.applicable,
    );
    const projectChecks = Object.values(projectResult.scripts || {});

    return {
      score: scoreResult.score,
      verdict: scoreResult.verdict,
      hardFail: scoreResult.hardFail,
      hardFailCodes: scoreResult.hardFailCodes,
      summary: {
        changedFileCount: diffResult.changedFileCount,
        staticChecksPassed: applicableStaticChecks.filter(
          (check) => check.passed === true,
        ).length,
        staticChecksFailed: applicableStaticChecks.filter(
          (check) => check.passed === false,
        ).length,
        sensitiveFilesDetected: diffResult.sensitiveFiles.length,
        projectChecksExecuted: projectChecks.filter(
          (check) => check.executed,
        ).length,
      },
      evidence: {
        baseCommit,
        unexpectedCommit,
      },
      diff: diffResult,
      staticChecks: staticCheckResults,
      project: projectResult,
      reasons: scoreResult.reasons,
    };
  }
}

const evaluatorService = new EvaluatorService();

module.exports = {
  EvaluatorService,
  evaluatorService,
};
