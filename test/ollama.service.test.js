const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  OllamaService,
  OllamaServiceError,
} = require('../src/services/ollama.service');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

test('listModels normalizes the Ollama tags response', async () => {
  const service = new OllamaService({
    fetchImpl: async () => jsonResponse({
      models: [
        {
          name: 'qwen3.5:4b',
          model: 'qwen3.5:4b',
          modified_at: '2026-08-28T00:00:00Z',
          size: 123,
          digest: 'abc',
          details: { family: 'qwen3' },
        },
      ],
    }),
  });

  const models = await service.listModels();

  assert.deepEqual(models, [
    {
      name: 'qwen3.5:4b',
      model: 'qwen3.5:4b',
      modifiedAt: '2026-08-28T00:00:00Z',
      size: 123,
      digest: 'abc',
      details: { family: 'qwen3' },
    },
  ]);
});

test('chat fails clearly when the configured model is missing', async () => {
  const service = new OllamaService({
    model: 'qwen3.5:4b',
    fetchImpl: async () => jsonResponse({
      models: [{ name: 'another-model:latest', model: 'another-model:latest' }],
    }),
  });

  await assert.rejects(
    () => service.chat('hello'),
    (error) => {
      assert.ok(error instanceof OllamaServiceError);
      assert.equal(error.code, 'OLLAMA_MODEL_NOT_FOUND');
      assert.equal(error.statusCode, 503);
      return true;
    },
  );
});

test('chat exposes only the public role and content fields', async () => {
  let requestCount = 0;
  const service = new OllamaService({
    model: 'qwen3.5:4b',
    fetchImpl: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return jsonResponse({
          models: [{ name: 'qwen3.5:4b', model: 'qwen3.5:4b' }],
        });
      }

      return jsonResponse({
        model: 'qwen3.5:4b',
        message: {
          role: 'assistant',
          content: 'Hello',
          thinking: 'internal model reasoning',
        },
        done: true,
        done_reason: 'stop',
      });
    },
  });

  const result = await service.chat('hello');

  assert.deepEqual(result.message, {
    role: 'assistant',
    content: 'Hello',
  });
  assert.equal(requestCount, 2);
});

test('network failures become an Ollama unavailable error', async () => {
  const service = new OllamaService({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  await assert.rejects(
    () => service.listModels(),
    (error) => {
      assert.ok(error instanceof OllamaServiceError);
      assert.equal(error.code, 'OLLAMA_UNAVAILABLE');
      assert.equal(error.statusCode, 503);
      return true;
    },
  );
});

test('upstream HTTP failures become a safe gateway error', async () => {
  const service = new OllamaService({
    fetchImpl: async () => jsonResponse({ error: 'internal failure' }, 500),
  });

  await assert.rejects(
    () => service.listModels(),
    (error) => {
      assert.ok(error instanceof OllamaServiceError);
      assert.equal(error.code, 'OLLAMA_HTTP_ERROR');
      assert.equal(error.statusCode, 502);
      assert.equal(error.upstreamStatus, 500);
      return true;
    },
  );
});
