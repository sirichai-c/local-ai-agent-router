# Local AI Agent Router

Local AI Agent Router is a local-first backend for classifying coding tasks, routing them to local coding agents, evaluating their changes, and keeping a human in control of merges.

Phase 5 adds coding-agent adapters and a read-only execution planner alongside deterministic routing, the local registry, and Ollama integration. Agent execution, isolated worktrees, evaluation, history, approvals, and sandboxing will be added incrementally in later phases.

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

## Coding Agent Registry

The registry describes OpenCode, Qwen Code, and Aider and checks the operating system `PATH` for their CLI commands. On Windows it uses `where.exe`; on Unix-like systems it falls back to `which`.

This phase reports whether each CLI is installed and currently available. It does not execute agents, select an agent, score capabilities, or install missing software.

### `GET /api/agents`

Returns all registered agents with their metadata and detected executable state.

### `GET /api/agents/:id`

Returns one registered agent. Unknown IDs return HTTP 404.

## Task Routing

```text
Task → Rule-based classification → Agent capability scoring → Ranking
```

The classifier matches maintainable English and Thai keyword rules across ten task categories. If no rule matches, it applies a conservative `coding: 40` fallback so the result remains deterministic and useful.

Capability numbers are initial heuristic routing priors, not objective benchmarks or official performance measurements. Historical performance will refine them in a later phase.

`recommendedAgent` is the best theoretical match regardless of installation state. `selectedAgent` is the highest-scoring agent currently available on the local `PATH`, or `null` if none are available.

### `POST /api/router/analyze`

Accepts a JSON body such as:

```json
{
  "task": "ช่วย refactor authentication service และตรวจ git diff ให้ด้วย"
}
```

Returns category scores, the recommended and selected agents, a ranked list, and the strongest scoring reasons. Phase 4 only analyzes and ranks; it never executes an agent.

## Agent Adapter Layer

```text
Router → Selected agent → Adapter registry → Specific adapter → Execution plan
```

Adapters translate the router's common task, workspace, and model inputs into each agent's separate `command`, argument array, working directory, and non-secret environment configuration.

| Agent | Adapter | Syntax source |
|---|---|---|
| OpenCode | `OpenCodeAdapter` | Locally verified with OpenCode 1.18.23 |
| Qwen Code | `QwenCodeAdapter` | Current official documentation; CLI not installed locally |
| Aider | `AiderAdapter` | Current official documentation; CLI not installed locally |

OpenCode uses `run`, JSON output, and the `provider/model` form verified by its local help. Because this environment has no global OpenCode Ollama provider, its plan supplies non-secret inline provider configuration pointing to Ollama's OpenAI-compatible `/v1` endpoint. It does not enable OpenCode's automatic permission approval option.

Qwen Code requires local provider configuration in its settings before a generated plan can use Ollama. Aider uses the documented `ollama_chat/` model prefix and disables automatic Git commits.

### `POST /api/router/plan`

Accepts a task and an existing workspace directory:

```json
{
  "task": "ช่วยตรวจ bug Express API และดู git diff",
  "workspace": "C:\\Projects\\example"
}
```

The endpoint validates the workspace, asks the deterministic router for the best available agent, and returns an invocation plan. If no agent is available, it returns `status: "no_available_agent"` with `invocation: null`.

**Phase 5 does not execute coding agents or modify the supplied workspace. Execution begins in Phase 6.**

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

Agent discovery follows a separate branch of the same layered request flow:

```text
Agent route → Agent controller → Agent registry service
    → Command detection utility → Operating system PATH
```

Task routing adds another deterministic service branch:

```text
Router route → Router controller → Router service
    → Task classifier + Agent registry + Agent scorer
```

Planning extends that branch without execution:

```text
POST /api/router/plan → Router controller → Agent planner
    → Router service → Selected agent → Adapter registry
    → Agent-specific invocation plan → NO EXECUTION
```

`src/app.js` assembles the HTTP application without opening a network port. `src/server.js` is the process entry point and owns startup and graceful shutdown. Keeping those responsibilities separate makes the API easier to test.

## Security baseline

- Local `.env` files and dependencies are excluded from Git.
- Express's identifying `X-Powered-By` response header is disabled.
- JSON request bodies have a size limit.
- Unknown routes return structured JSON rather than an HTML error page.
- Ollama calls use fixed API paths, JSON bodies, and a request timeout.
- Upstream network and HTTP failures are translated into safe structured errors.
- Agent command detection uses argument arrays without shell command construction.
- Task routing is local, deterministic, and does not call an LLM or external AI API.
- Planner inputs cannot supply commands; adapters accept only known registry commands.
- User task text remains one argument element and is never assembled into a shell string.

Ollama remains available only for the explicit chat endpoints. The task router does not use it and does not execute coding agents or untrusted project code.
