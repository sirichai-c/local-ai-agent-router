# Local AI Agent Router

Local AI Agent Router is a local-first backend for classifying coding tasks, routing them to local coding agents, evaluating their changes, and keeping a human in control of merges.

Phase 7 adds deterministic evaluation of agent changes after gated execution in an isolated Git worktree. Qwen Code also uses its verified Docker sandbox after live validation demonstrated that a worktree alone cannot confine host filesystem writes. Competition, history, approvals, merging, and generalized agent sandboxing will be added incrementally in later phases.

## Requirements

- Node.js 20 or newer
- npm
- Git
- Ollama 0.33 or a compatible version
- The configured local model (default: `qwen3:8b`)

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
OLLAMA_MODEL=qwen3:8b
```

Agent execution remains disabled unless it is explicitly enabled:

```dotenv
AGENT_EXECUTION_ENABLED=false
AGENT_PROCESS_TIMEOUT_MS=600000
AGENT_MAX_OUTPUT_BYTES=1048576
AGENT_WORKTREE_ROOT=
EVALUATOR_RUN_PROJECT_SCRIPTS=false
EVALUATOR_MAX_CHANGED_FILES=50
EVALUATOR_MAX_DIFF_BYTES=524288
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

`installed` means a CLI was found on `PATH`. `available` additionally means the platform has a spawn-safe executable. On Windows, npm `.cmd` shims are not executed through a shell; OpenCode resolves to its verified native `opencode.exe` instead. Missing software is never installed automatically.

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
| Qwen Code | `QwenCodeAdapter` | Locally verified with Qwen Code 0.22.3 |
| Aider | `AiderAdapter` | Current official documentation; CLI not installed locally |

OpenCode uses `run`, JSON output, and the `provider/model` form verified by its local help. Because this environment has no global OpenCode Ollama provider, its plan supplies non-secret inline provider configuration pointing to Ollama's OpenAI-compatible `/v1` endpoint and declares the model's verified reasoning/tool-call capabilities. It does not enable OpenCode's automatic permission approval option.

Qwen Code 0.22.3 uses its verified OpenAI-compatible provider flags with Ollama. Its adapter enables the installed Docker sandbox, maps Windows worktree paths to the container's verified `/c/...` form, reaches host Ollama through `host.docker.internal`, disables Qwen 3 thinking with Ollama's supported `reasoning_effort: "none"`, and redirects `QWEN_HOME` to a task-local runtime directory so the container does not mount the user's real Qwen credentials. Aider uses the documented `ollama_chat/` model prefix and disables automatic Git commits.

### `POST /api/router/plan`

Accepts a task and an existing workspace directory:

```json
{
  "task": "ช่วยตรวจ bug Express API และดู git diff",
  "workspace": "C:\\Projects\\example"
}
```

The endpoint validates the workspace, asks the deterministic router for the best available agent, and returns an invocation plan. If no agent is available, it returns `status: "no_available_agent"` with `invocation: null`.

The planner remains read-only. Agent execution is available only through the separately gated task endpoint below.

## Agent Execution

```text
Task -> Router -> Selected agent -> Git worktree -> Agent execution -> Changes
```

### `POST /api/tasks/execute`

Accepts the same `task` and `workspace` fields as the planning endpoint. Before execution, the service requires all of the following:

- `AGENT_EXECUTION_ENABLED=true`
- an available spawn-safe agent executable
- an existing Git repository with a valid attached `HEAD`
- a clean target working tree
- a unique branch and worktree outside the original repository

The default gate is `false`. A disabled request returns `status: "execution_disabled"` and does not inspect Git, create a worktree, or start an agent.

For enabled requests, the service captures the target branch and base commit, creates `agent/<task-id>-<agent-id>`, and runs the selected adapter with the new worktree as its `cwd`. Standard output and error are captured with a combined byte limit, and execution has a configurable timeout. Qwen Code additionally runs file tools in its Docker sandbox; its first run may pull the sandbox image bundled for the installed CLI version.

The original repository is never checked out, reset, committed, or merged by this flow. Candidate changes are evaluated immediately and their worktree remains available for later human review. An unexpected agent-created commit is detected by comparing worktree `HEAD` with `baseCommit` and marks the result as failed.

`changedFiles` includes tracked and untracked status entries. The baseline `git diff HEAD` output covers tracked changes but does not contain untracked file content. The evaluator separately discovers untracked paths with Git, checks their names, and safely reads supported files for static validation without claiming they are present in the tracked diff.

## Evaluator Engine

An agent saying "Done" is not evidence that its change is correct. After every enabled execution, the evaluator independently inspects the process result and worktree evidence:

```text
Agent result -> Diff evaluator -> Static evaluator -> Project evaluator
    -> Score evaluator -> pass / warning / fail
```

The evaluator:

- counts tracked and untracked changed files
- measures the tracked diff using UTF-8 bytes
- detects sensitive paths such as `.env`, credentials, tokens, and private keys without reading or returning their contents
- validates changed `.js`, `.cjs`, and `.mjs` files with `node --check`
- parses changed JSON files with `JSON.parse`
- rejects changed paths that escape the worktree and does not follow changed symbolic links
- detects `test`, `lint`, and `build` scripts in `package.json`
- produces a deterministic score from 0 to 100 with a `pass`, `warning`, or `fail` verdict

If any sensitive path is detected, the API redacts the entire tracked diff plus Agent stdout/stderr from the execution response (`diff: null`, `diffRedacted: true`, `outputRedacted: true`) so changed secret values cannot leak through the result payload.

Scoring starts at 100 and applies explicit deductions for process failure, timeout, unexpected commits, no changes, risky change scope, oversized tracked diffs, static failures, invalid `package.json`, sensitive paths, and truncated output. Timeouts, unexpected commits, sensitive paths, and unsafe changed paths are hard failures. A changed JavaScript or JSON syntax failure also forces a fail verdict even when its numerical score would otherwise be a warning.

| Evidence | Score impact |
|---|---:|
| Agent process failure | -35 |
| Timeout | -40 |
| Unexpected Agent commit | -30 |
| No changes | -20 |
| Sensitive file | -50 each |
| Changed-file limit exceeded | -20 |
| Tracked diff limit exceeded | -15 |
| Failed static check | -20 each |
| Invalid `package.json` | -30 |
| Executed project check failure | -20 each |
| Truncated Agent output | -5 |

Scores are clamped to 0–100. Scores of 90 or more pass, scores from 70 through 89 warn, and lower scores fail unless a hard or forced static failure already requires `fail`.

Execution statuses now distinguish process success from evaluation quality:

| Status | Meaning |
|---|---|
| `completed` | Agent succeeded and evaluation passed |
| `completed_with_warnings` | Agent succeeded and evaluation returned warning |
| `evaluation_failed` | Agent succeeded but evaluation failed |
| `failed` | Agent process failed, timed out, or unexpectedly committed |

`EVALUATOR_RUN_PROJECT_SCRIPTS` defaults to `false`. Phase 7 detects project scripts but never executes Agent-modified `package.json` scripts on the Windows host. Even when the variable is explicitly requested, host execution remains unsupported until the Phase 11A project sandbox exists. Skipped scripts receive no score deduction.

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

Execution uses an isolated source-control branch:

```text
POST /api/tasks/execute -> Task controller -> Agent executor
    -> Router -> Execution gate -> Git validation
    -> External worktree -> Adapter -> Safe process runner
    -> Worktree evidence -> Evaluator service -> Verdict
    -> NO COMMIT / NO MERGE
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
- The process runner uses a command allowlist and `spawn` with `shell: false`.
- Execution has a timeout and a combined stdout/stderr memory limit.
- Agent `cwd` is always the isolated worktree, never the original repository.
- Dirty repositories and detached `HEAD` states are rejected without automatic stash or commit.
- Evaluator file reads are constrained to the worktree and changed symbolic links are not followed.
- Project scripts are detected but not run on the host during Phase 7.

Git worktrees isolate source-control state, not the operating-system process. Qwen Code receives an additional Docker filesystem boundary in Phase 6 because live validation proved that prompt instructions and `cwd` do not prevent an agent from choosing an external absolute path. OpenCode and Aider still use host execution when explicitly enabled, and best-effort Windows process termination may not kill every descendant process. Phase 11 will replace this agent-specific safeguard with a generalized sandbox execution backend.

The local Qwen Code 0.22.3 and `qwen3:8b` combination completed the bounded live validation that created a new documentation file. Existing-file edits that required a read followed by another tool call were not consistently reliable because the model sometimes interpreted tool output as a new instruction. This is a current model/CLI limitation, not a successful general-purpose edit guarantee.
