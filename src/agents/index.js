const AiderAdapter = require('./aider.adapter');
const OpenCodeAdapter = require('./opencode.adapter');
const QwenCodeAdapter = require('./qwen-code.adapter');

const adapters = Object.freeze({
  opencode: new OpenCodeAdapter(),
  'qwen-code': new QwenCodeAdapter(),
  aider: new AiderAdapter(),
});

function getAdapter(agentId) {
  return adapters[agentId] || null;
}

module.exports = {
  getAdapter,
};
