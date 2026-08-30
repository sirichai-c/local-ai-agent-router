const { config } = require('./env');

const SENSITIVE_FILE_RULES = Object.freeze([
  Object.freeze({
    id: 'dotenv-file',
    severity: 'critical',
    description: 'Environment files may contain credentials or local secrets.',
    matches: (basename) => (
      basename === '.env'
      || (basename.startsWith('.env.') && basename !== '.env.example')
    ),
  }),
  Object.freeze({
    id: 'npm-credentials',
    severity: 'critical',
    description: '.npmrc may contain registry credentials.',
    matches: (basename) => basename === '.npmrc',
  }),
  Object.freeze({
    id: 'credential-json',
    severity: 'critical',
    description: 'Credential and secret JSON files are sensitive.',
    matches: (basename) => [
      'credential.json',
      'credentials.json',
      'secret.json',
      'secrets.json',
    ].includes(basename),
  }),
  Object.freeze({
    id: 'ssh-private-key',
    severity: 'critical',
    description: 'SSH private key filenames are sensitive.',
    matches: (basename) => ['id_rsa', 'id_ed25519'].includes(basename),
  }),
  Object.freeze({
    id: 'private-key-extension',
    severity: 'critical',
    description: 'Private key and certificate container files are sensitive.',
    matches: (basename) => /\.(pem|key|p12|pfx)$/u.test(basename),
  }),
  Object.freeze({
    id: 'sensitive-name-prefix',
    severity: 'critical',
    description: 'Token, private key, and service account files are sensitive.',
    matches: (basename) => /^(private[-_]key|service[-_]account|auth[-_]token|access[-_]token)(?:[._-]|$)/u
      .test(basename),
  }),
]);

const evaluatorConfig = Object.freeze({
  runProjectScripts: config.evaluator.runProjectScripts,
  maxChangedFiles: config.evaluator.maxChangedFiles,
  maxDiffBytes: config.evaluator.maxDiffBytes,
  sensitiveFileRules: SENSITIVE_FILE_RULES,
});

module.exports = {
  SENSITIVE_FILE_RULES,
  evaluatorConfig,
};
