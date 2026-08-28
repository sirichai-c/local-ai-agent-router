# Local AI Agent Router

Local AI Agent Router is a local-first backend for classifying coding tasks, routing them to local coding agents, evaluating their changes, and keeping a human in control of merges.

Phase 2 connects the Express foundation to a local Ollama runtime for model discovery, dependency health checks, and non-streaming chat with a configured Qwen model. Agent routing, isolated execution, evaluation, history, approvals, and sandboxing will be added incrementally in later phases.

## Requirements

- Node.js 20 or newer
- npm
- Git
- Ollama 0.33 or a compatible version
- The configured local model (default: `qwen3.5:4b`)

## Setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The server listens on port `3000` unless `PORT` is changed in `.env`. Ollama must be running at the configured base URL.

Phase 2 configuration:

```dotenv
PORT=3000
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
```

## Commands

- `npm start` — run the API with Node.js.
- `npm run dev` — run the API with nodemon and restart after source changes.
- `npm test` — run the built-in Node.js test suite.

## API

### `GET /health`

Returns a basic service readiness response:

```json
{
  "status": "ok",
  "service": "local-ai-agent-router"
}
```

### `GET /api/models`

Returns the models installed in Ollama and indicates whether the configured model is available.

### `GET /api/ollama/health`

Checks the Ollama HTTP API and the configured model. It returns HTTP 503 if Ollama cannot be reached or the configured model is missing.

### `POST /api/chat`

Sends one non-streaming user message to the configured model:

```json
{
  "message": "Explain REST APIs"
}
```

The endpoint returns HTTP 400 for an invalid message, HTTP 503 when Ollama or the model is unavailable, HTTP 504 on timeout, and HTTP 502 for invalid or failed upstream responses.

## Current architecture

```text
HTTP request
    ↓
Express application
    ↓
Route
    ↓
Controller
    ↓
Ollama service
    ↓
Local Ollama HTTP API
    ↓
JSON response
```

`src/app.js` assembles the HTTP application without opening a network port. `src/server.js` is the process entry point and owns startup and graceful shutdown. Keeping those responsibilities separate makes the API easier to test.

## Security baseline

- Local `.env` files and dependencies are excluded from Git.
- Express's identifying `X-Powered-By` response header is disabled.
- JSON request bodies have a size limit.
- Unknown routes return structured JSON rather than an HTML error page.
- Ollama calls use fixed API paths, JSON bodies, and a request timeout.
- Upstream network and HTTP failures are translated into safe structured errors.

This phase communicates only with the configured Ollama HTTP API. It does not execute coding agents or untrusted project code.
