const sandboxAgents = Object.freeze({
  opencode: Object.freeze({
    command: 'opencode',
    environment: Object.freeze(['OPENCODE_CONFIG_CONTENT']),
  }),
  'qwen-code': Object.freeze({
    command: 'qwen',
    environment: Object.freeze([
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_MODEL',
      'QWEN_HOME',
      'QWEN_RUNTIME_DIR',
      'QWEN_TELEMETRY_ENABLED',
      'QWEN_USAGE_STATISTICS_ENABLED',
    ]),
  }),
});

function getSandboxAgent(agentId) {
  return sandboxAgents[agentId] || null;
}

module.exports = {
  getSandboxAgent,
  sandboxAgents,
};
