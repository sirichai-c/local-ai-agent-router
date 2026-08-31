const {
  agentRegistryService,
} = require('./agent-registry.service');
const { agentScorerService } = require('./agent-scorer.service');
const { adaptiveScorerService } = require('./adaptive-scorer.service');
const { taskClassifierService } = require('./task-classifier.service');

class RouterService {
  constructor({
    classifier = taskClassifierService,
    registry = agentRegistryService,
    scorer = agentScorerService,
    adaptiveScorer = adaptiveScorerService,
  } = {}) {
    this.classifier = classifier;
    this.registry = registry;
    this.scorer = scorer;
    this.adaptiveScorer = adaptiveScorer;
  }

  toRankingEntry(agent, staticScoring, adaptiveScoring) {
    return {
      id: agent.id,
      name: agent.name,
      installed: agent.installed,
      available: agent.available,
      command: agent.command,
      executablePath: agent.executablePath,
      executionCommand: agent.executionCommand,
      executionArgs: [...(agent.executionArgs || [])],
      runtime: agent.runtime,
      host: agent.host,
      sandbox: agent.sandbox,
      score: adaptiveScoring.score,
      staticScore: adaptiveScoring.staticScore,
      historicalScore: adaptiveScoring.historicalScore,
      recentScore: adaptiveScoring.recentScore,
      sampleSize: adaptiveScoring.sampleSize,
      adaptive: adaptiveScoring.adaptive,
      reasons: staticScoring.reasons,
    };
  }

  async analyzeTask(task) {
    if (typeof task !== 'string' || task.trim() === '') {
      throw new TypeError('task must be a non-empty string');
    }

    const normalizedInput = task.trim();
    const classification = this.classifier.classifyTask(normalizedInput);
    const agents = await this.registry.getAgents();
    const scoredAgents = await Promise.all(
      agents.map(async (agent, registryIndex) => {
        const staticScoring = this.scorer.scoreAgent(agent, classification);
        const adaptiveScoring = await this.adaptiveScorer.scoreAgentWithHistory({
          agent,
          staticScore: staticScoring.score,
          classification,
        });

        return {
          ...this.toRankingEntry(agent, staticScoring, adaptiveScoring),
          registryIndex,
        };
      }),
    );
    const ranking = scoredAgents
      .sort((left, right) => (
        right.score - left.score || left.registryIndex - right.registryIndex
      ))
      .map(({ registryIndex, ...agent }) => agent);

    return {
      task: normalizedInput,
      classification,
      recommendedAgent: ranking[0] || null,
      selectedAgent: ranking.find((agent) => agent.available) || null,
      ranking,
    };
  }
}

const routerService = new RouterService();

module.exports = {
  RouterService,
  routerService,
};
