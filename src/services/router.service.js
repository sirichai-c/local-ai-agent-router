const {
  agentRegistryService,
} = require('./agent-registry.service');
const { agentScorerService } = require('./agent-scorer.service');
const { taskClassifierService } = require('./task-classifier.service');

class RouterService {
  constructor({
    classifier = taskClassifierService,
    registry = agentRegistryService,
    scorer = agentScorerService,
  } = {}) {
    this.classifier = classifier;
    this.registry = registry;
    this.scorer = scorer;
  }

  toRankingEntry(agent, scoring) {
    return {
      id: agent.id,
      name: agent.name,
      installed: agent.installed,
      available: agent.available,
      score: scoring.score,
      reasons: scoring.reasons,
    };
  }

  async analyzeTask(task) {
    if (typeof task !== 'string' || task.trim() === '') {
      throw new TypeError('task must be a non-empty string');
    }

    const normalizedInput = task.trim();
    const classification = this.classifier.classifyTask(normalizedInput);
    const agents = await this.registry.getAgents();
    const ranking = agents
      .map((agent, registryIndex) => {
        const scoring = this.scorer.scoreAgent(agent, classification);

        return {
          ...this.toRankingEntry(agent, scoring),
          registryIndex,
        };
      })
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
