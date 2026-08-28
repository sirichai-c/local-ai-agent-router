const {
  FALLBACK_CLASSIFICATION,
  TASK_CATEGORIES,
  taskRules,
} = require('../config/task-rules');

const ASCII_KEYWORD_PATTERN = /^[a-z0-9 ._-]+$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTask(task) {
  if (typeof task !== 'string') {
    throw new TypeError('task must be a string');
  }

  const normalized = task
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    throw new TypeError('task must be a non-empty string');
  }

  return normalized;
}

function matchesKeyword(normalizedTask, keyword) {
  const normalizedKeyword = keyword.toLocaleLowerCase('en-US');

  if (!ASCII_KEYWORD_PATTERN.test(normalizedKeyword)) {
    return normalizedTask.includes(normalizedKeyword);
  }

  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedKeyword)}(?=$|[^a-z0-9])`,
  );

  return pattern.test(normalizedTask);
}

class TaskClassifierService {
  classifyTask(task) {
    const normalizedTask = normalizeTask(task);
    const scores = Object.fromEntries(
      TASK_CATEGORIES.map((category) => [category, 0]),
    );
    let matchedRule = false;

    for (const category of TASK_CATEGORIES) {
      for (const rule of taskRules[category]) {
        const matches = rule.keywords.some((keyword) => (
          matchesKeyword(normalizedTask, keyword)
        ));

        if (matches) {
          // A group of synonymous keywords contributes once, preventing severe
          // double counting when a task repeats the same intent in several ways.
          scores[category] = Math.min(100, scores[category] + rule.weight);
          matchedRule = true;
        }
      }
    }

    if (!matchedRule) {
      // Unknown tasks receive a conservative coding baseline so routing still
      // produces a deterministic recommendation instead of an all-zero tie.
      Object.assign(scores, FALLBACK_CLASSIFICATION);
    }

    return scores;
  }
}

const taskClassifierService = new TaskClassifierService();

module.exports = {
  TaskClassifierService,
  matchesKeyword,
  normalizeTask,
  taskClassifierService,
};
