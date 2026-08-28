# Local AI Agent Router

Local AI Agent Router is a local-first backend for classifying coding tasks, routing them to local coding agents, evaluating their changes, and keeping a human in control of merges.

Phase 1 provides the Node.js and Express foundation. Agent routing, Ollama integration, isolated execution, evaluation, history, approvals, and sandboxing will be added incrementally in later phases.

## Requirements

- Node.js 20 or newer
- npm
- Git

## Setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The server listens on port `3000` unless `PORT` is changed in `.env`.

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
JSON response
```

`src/app.js` assembles the HTTP application without opening a network port. `src/server.js` is the process entry point and owns startup and graceful shutdown. Keeping those responsibilities separate makes the API easier to test.

## Security baseline

- Local `.env` files and dependencies are excluded from Git.
- Express's identifying `X-Powered-By` response header is disabled.
- JSON request bodies have a size limit.
- Unknown routes return structured JSON rather than an HTML error page.

This foundation does not execute coding agents or untrusted project code.
