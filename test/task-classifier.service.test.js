const assert = require('node:assert/strict');
const { test } = require('node:test');

const { TASK_CATEGORIES } = require('../src/config/task-rules');
const {
  TaskClassifierService,
} = require('../src/services/task-classifier.service');

const classifier = new TaskClassifierService();

test('classifyTask always returns every supported category', () => {
  const classification = classifier.classifyTask('debug this API error');

  assert.deepEqual(Object.keys(classification), TASK_CATEGORIES);
  assert.ok(classification.coding > 0);
  assert.ok(classification.debugging > 0);
  assert.ok(Object.values(classification).every((score) => score <= 100));
});

test('classifyTask recognizes mixed Thai and English routing signals', () => {
  const classification = classifier.classifyTask(
    'ช่วย refactor authentication service และตรวจ git diff ให้ด้วย',
  );

  assert.equal(classification.refactor, 90);
  assert.equal(classification.git, 90);
  assert.equal(classification.coding, 30);
});

test('synonyms in one rule group contribute only once', () => {
  const classification = classifier.classifyTask(
    'refactor and refactoring while ปรับโครงสร้าง',
  );

  assert.equal(classification.refactor, 90);
});

test('classifyTask applies a coding fallback when no rule matches', () => {
  const classification = classifier.classifyTask('please improve this');

  assert.equal(classification.coding, 40);
  assert.deepEqual(
    Object.entries(classification)
      .filter(([category]) => category !== 'coding')
      .map(([, score]) => score),
    Array(TASK_CATEGORIES.length - 1).fill(0),
  );
});

test('classifyTask rejects invalid service input defensively', () => {
  assert.throws(() => classifier.classifyTask(null), TypeError);
  assert.throws(() => classifier.classifyTask('   '), TypeError);
});
