# Local AI Agent Router

Local AI Agent Router is a local-first backend for classifying coding tasks, routing them to local coding agents, evaluating their changes, and keeping a human in control of merges.

Phase 12 adds a local React Dashboard over the existing request/response APIs. Project scripts still run only in disposable Docker snapshots, Coding Agents default to an isolated Docker backend, and fingerprint-bound human approval remains the only path to a local merge.

## Requirements

- Node.js 20 or newer
- npm
- Git
- Docker Desktop with a running Linux container engine
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
AGENT_EXECUTION_BACKEND=docker
AGENT_SANDBOX_IMAGE=local-agent-router/agent-sandbox:1
AGENT_PROCESS_TIMEOUT_MS=600000
AGENT_MAX_OUTPUT_BYTES=1048576
AGENT_WORKTREE_ROOT=
EVALUATOR_RUN_PROJECT_SCRIPTS=false
EVALUATOR_MAX_CHANGED_FILES=50
EVALUATOR_MAX_DIFF_BYTES=524288
COMPETITION_MAX_AGENTS=3
COMPETITION_EXECUTION_MODE=sequential
COMPETITION_QUALITY_WEIGHT=0.70
COMPETITION_ROUTER_WEIGHT=0.20
COMPETITION_SPEED_WEIGHT=0.10
DATABASE_PATH=./data/agent-router.db
ADAPTIVE_ROUTING_ENABLED=true
ADAPTIVE_STATIC_WEIGHT=0.50
ADAPTIVE_HISTORY_WEIGHT=0.30
ADAPTIVE_RECENT_WEIGHT=0.20
ADAPTIVE_MIN_SAMPLES=3
ADAPTIVE_RECENT_SAMPLE_SIZE=10
SANDBOX_ENABLED=true
SANDBOX_IMAGE=local-agent-router/node-sandbox:1
SANDBOX_MEMORY=2g
SANDBOX_CPUS=2
SANDBOX_PIDS_LIMIT=256
SANDBOX_TIMEOUT_MS=300000
SANDBOX_INSTALL_TIMEOUT_MS=300000
SANDBOX_INSTALL_DEPENDENCIES=true
SANDBOX_KEEP_RUNS=false
SANDBOX_RUN_ROOT=./.sandbox-runs
```

## Commands

Dashboard commands:

- `npm run web:dev` — run the Vite Dashboard development server on port 5173.
- `npm run web:test` — run the Dashboard unit and interaction tests.
- `npm run web:build` — create the local production Dashboard in `web/dist`.
- `npm run build` — alias for the Dashboard production build.

For Dashboard development, run the backend and frontend in separate terminals:

```powershell
# Terminal 1
npm run dev

# Terminal 2
npm run web:dev
```

Vite proxies `/api` and `/health` to `http://localhost:3000`, so broad backend CORS is not enabled. For a built local application, run `npm run web:build` and then `npm start`; Express serves the SPA and APIs from `http://localhost:3000`. The backend continues to start and serve APIs when `web/dist` is absent.

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

`installed` retains its original meaning: a CLI was found on the host `PATH`. `host.available` additionally means the host has a spawn-safe executable. `sandbox.available` describes the configured isolated runtime, while top-level `available` is the effective availability for the selected backend. A Docker image does not falsely make `installed=true`. Missing software is never installed automatically.

### `GET /api/agents`

Returns all registered agents with their metadata and detected executable state.

### `GET /api/agents/:id`

Returns one registered agent. Unknown IDs return HTTP 404.

## Task Routing

```text
Task → Rule-based classification → Agent capability scoring → Ranking
```

The classifier matches maintainable English and Thai keyword rules across ten task categories. If no rule matches, it applies a conservative `coding: 40` fallback so the result remains deterministic and useful.

Capability numbers are initial heuristic routing priors, not objective benchmarks or official performance measurements. Phase 9 retains these priors as the largest configured routing component and uses local historical evidence only as an explainable adjustment.

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

Qwen Code 0.22.3 uses its verified OpenAI-compatible provider flags with Ollama. In the Router Docker backend its adapter uses the fixed `/workspace` mount, avoids starting Qwen's nested sandbox, and keeps `QWEN_HOME` on container tmpfs. OpenCode receives an equally explicit `/workspace` prompt and non-secret inline Ollama provider configuration. Aider uses the documented `ollama_chat/` model prefix and disables automatic Git commits, but is not included in the current Agent sandbox image.

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
- an Agent available in the configured execution backend
- an existing Git repository with a valid attached `HEAD`
- a clean target working tree
- a unique branch and worktree outside the original repository

The default gate is `false`. A disabled request returns `status: "execution_disabled"` and does not inspect Git, create a worktree, or start an agent.

For enabled requests, the service captures the target branch and base commit, creates `agent/<task-id>-<agent-id>`, and gives the adapter that worktree as its logical `cwd`. The configured backend then runs the invocation. Docker is the secure default; `host` remains an explicit compatibility option, and `sbx` fails closed because that runtime is not installed. Standard output and error keep the existing combined byte limit and timeout.

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

## Multi-Agent Competition

```text
Same task -> Analyze once -> Same base commit
    -> Separate agent branches/worktrees -> Independent evaluation
    -> Deterministic ranking -> Winner candidate
```

### `POST /api/tasks/compete`

Accepts a task, a clean Git workspace, and an optional list of known Agent IDs:

```json
{
  "task": "Add input validation to the API",
  "workspace": "C:\\Projects\\example",
  "agents": ["opencode", "qwen-code"]
}
```

If `agents` is omitted, the service takes available agents in router-ranking order up to `COMPETITION_MAX_AGENTS`. Explicit unknown, unavailable, duplicate, or over-limit lists are rejected rather than silently substituted. Fewer than two available candidates returns `insufficient_competitors` without running an Agent.

The task is classified once and the clean repository's branch and `baseCommit` are captured once. Every candidate then receives that exact commit, the same competition ID, and its own `agent/<competition-id>-<agent-id>` branch and external worktree. Execution is deliberately sequential because all local agents share Ollama and local CPU/GPU resources. One candidate failure is recorded without preventing later candidates from running.

Competition scores are deterministic:

```text
70% Phase 7 evaluator quality
20% router suitability
10% relative execution speed
```

Relative speed is `fastest duration / candidate duration * 100`. Only `completed` and `completed_with_warnings` candidates are winner-eligible. `failed` and `evaluation_failed` candidates remain visible for diagnostics but can never win. Ties use evaluation score, router score, duration, and finally Agent ID in that order.

The response preserves each candidate's evaluation, changed and untracked paths, tracked-diff metadata, branch, worktree, and base commit. It does not claim that the tracked diff contains untracked file contents.

The winner is only the best current candidate according to deterministic evidence. Phase 8 does not commit, merge, approve, or delete any candidate branch/worktree. Cleanup remains manual until the approval workflow is implemented.

## Persistent Performance Memory

```text
Agent does work -> Evaluator gives score -> SQLite remembers metadata
    -> Future router combines static + category history + recent history
```

Phase 9 records actual enabled execution attempts from both `POST /api/tasks/execute` and `POST /api/tasks/compete`. Analyze, plan, execution-disabled, and insufficient-competitor requests do not create history because no Agent ran. A competition creates one task record and one run record per candidate after all candidates have finished, so Agent A's result cannot change the routing scores already captured for Agent B in the same competition.

The SQLite database defaults to `./data/agent-router.db`. Its parent directory is created at runtime, WAL and foreign-key enforcement are enabled, and schema initialization is idempotent. Database, WAL, and shared-memory files are ignored by Git. The database stores task text, local workspace paths, nonzero task-category scores, execution/evaluation scores, statuses, durations, branches, and worktree paths. It deliberately does not store Agent stdout, stderr, raw diffs, file contents, secrets, or environment values.

Adaptive routing exposes four related values:

- `staticScore` is the Phase 4 capability-prior compatibility score.
- `historicalScore` is a task-category-weighted average from categories with at least `ADAPTIVE_MIN_SAMPLES` distinct runs.
- `recentScore` is the average quality of the Agent's latest configured number of runs, including failed runs as zero-quality evidence when no evaluation score exists.
- `score` is the effective routing score. It combines available components using the configured weights and renormalizes when a history component is missing.

Cold start is conservative. If adaptive routing is disabled or neither category nor recent history has enough samples, `score` equals `staticScore` and `adaptive` is `false`. Missing category history is excluded rather than treated as zero. Static configuration is never rewritten by observed results.

### `GET /api/history/tasks`

Returns recent execution tasks with a default limit of 20 and a maximum of 100. Use `?limit=N` for a bounded result.

### `GET /api/history/tasks/:id`

Returns one task, its stored nonzero classification categories, and metadata-only Agent runs. Unknown task IDs return HTTP 404.

### `GET /api/performance/agents/:id`

Returns registry metadata plus global and recent statistics for one known Agent. Statistics separate successful execution status from evaluator pass, warning, and failure rates.

### `GET /api/performance/agents/:id/categories/:category`

Returns category-weighted evaluation performance, pass rate, and average duration for one of the ten known task categories. Distinct Agent runs determine sample size, so multi-category tasks are not counted multiple times.

## Human Approval Workflow

```text
Candidate -> Evaluator -> SHA-256 fingerprint -> Human review
    -> Reject: preserve target + clean candidate state
    -> Approve exact fingerprint: revalidate -> commit -> local merge -> cleanup
```

A competition winner is only a candidate, and an evaluator `pass` is only evidence. Neither can merge code. The only merge entry point is the human approval endpoint, which requires the fingerprint returned by a fresh candidate review.

The fingerprint includes the evaluated base commit, current worktree `HEAD`, normalized Git status, tracked diff, untracked paths, and streamed SHA-256 content hashes for safe regular untracked files. Candidate paths are constrained lexically and by real path to the registered worktree; symbolic-link escapes are rejected. The database stores only the final fingerprint, not untracked contents.

Before approval mutates Git, the service verifies the stored and expected fingerprints, recomputes fresh evidence, confirms the candidate is unchanged and has real changes, and checks that the original repository is clean, on the recorded target branch, free of merge/rebase state, and still at the recorded base commit. It never checks out, stashes, rebases, resets hard, cleans, or pushes the target repository.

After revalidation, the workflow stages the candidate worktree, verifies that the staged snapshot still equals the human-reviewed content snapshot, creates a controlled single-line `agent:` commit, and verifies its committed patch and ancestry. The local target merges the immutable reviewed commit with a no-fast-forward merge. Only after the database records approval are the winner and loser worktrees and validated `agent/<task>-<agent>` branches removed.

### `GET /api/tasks/:id/candidate`

Inspects the current registered candidate worktree rather than trusting stale SQLite Git metadata. The response includes current changed/untracked paths, a redacted tracked diff when necessary, the stored fingerprint, and `approvable` plus a reason. Phase 9 candidates without fingerprints return `candidate_not_approval_compatible` and must be rerun.

### `POST /api/tasks/:id/approve`

Requires:

```json
{
  "expectedFingerprint": "sha256:..."
}
```

Fingerprint mismatch, candidate mutation, a dirty/wrong/stale target, or an in-progress Git operation returns HTTP 409 without merging. Repeated approval is idempotent and returns `already_approved`. Approval merges only the local target branch; remote push remains a separate explicit user action.

### `POST /api/tasks/:id/reject`

Records rejection before validated candidate cleanup and never changes the target branch. Repeated rejection returns `already_rejected`. An approved task cannot be rejected, and a rejected task cannot later be approved.

## Project Evaluation Sandbox

Phase 11A separates project checks from the Windows host. When `EVALUATOR_RUN_PROJECT_SCRIPTS=true`, `test`, `lint`, and `build` are executed only through the Docker evaluation sandbox; there is no host `npm test` fallback.

```text
Candidate worktree -> safe snapshot -> dependency install container
    -> network-none test/lint/build containers -> Evaluator evidence
```

The safe snapshot copies regular files without following symbolic links and excludes `.git`, `node_modules`, `.agent-worktrees`, and `.sandbox-runs`. Project scripts modify only this disposable copy, never the candidate that will later be fingerprinted and reviewed.

Dependency installation uses `npm ci` when `package-lock.json` exists, otherwise `npm install`, always with `--ignore-scripts --no-audit --no-fund`. This stage may use Docker's bridge network. Actual project scripts run deterministically in `test`, `lint`, `build` order with `--network none`.

The image is built locally with:

```powershell
docker build --tag local-agent-router/node-sandbox:1 --file docker/sandbox-node/Dockerfile .
```

Containers use memory, CPU, and PID limits, drop all Linux capabilities, enable `no-new-privileges`, use a read-only root filesystem and non-root user, and mount only the disposable snapshot as writable. They do not receive the host environment, Docker socket, Router `.env`, user home, or Git metadata. `SANDBOX_KEEP_RUNS=false` removes snapshots after evaluation.

An install failure is reported separately and causes available scripts to remain unexecuted with `passed: null`; it is not misreported as a failed test. An executed script failure continues to use the deterministic Phase 7 project-check deduction.

## Coding Agent Sandbox

Phase 11B separates Agent execution from the Windows user process:

```text
Router -> Adapter -> Docker Agent backend -> /workspace candidate
                                      |
                                      +-> host.docker.internal -> Ollama
```

Build the pinned local Agent image with:

```powershell
docker build --tag local-agent-router/agent-sandbox:1 --file docker/sandbox-agents/Dockerfile .
```

The image contains the locally validated OpenCode 1.18.23 and Qwen Code 0.22.3 CLIs. The backend mounts exactly one policy-generated Agent worktree at `/workspace`; it does not mount the main repository, Router `.env`, user home, credentials, another candidate, or Docker socket. It runs as UID/GID 1000 with a read-only root filesystem, tmpfs `/tmp`, memory/CPU/PID limits, all capabilities dropped, and `no-new-privileges`. Adapter argument semantics remain separate from Docker lifecycle policy.

Before an Agent starts, a short container probe verifies Ollama `/api/tags` through `host.docker.internal`. Failure to inspect the image, reach Ollama, or start the sandbox returns a controlled capability error and never falls back to host execution. Timeout cleanup destroys the temporary container but preserves the candidate worktree for evidence and human review.

`AGENT_EXECUTION_BACKEND=host` is retained only as an explicit compatibility/testing choice. `AGENT_EXECUTION_BACKEND=sbx` currently fails closed because the `sbx` command is unavailable on this machine. Aider is not included in the Docker image, so it is unavailable while the Docker backend is selected.

Agent containers currently require Docker bridge networking to reach host Ollama. Docker Desktop does not provide a simple per-destination egress allowlist through these command-line flags, so outbound Agent network is not yet restricted solely to Ollama. No host network mode or LAN-wide Ollama binding is enabled. This is the principal remaining Phase 11 network limitation.

The live validation used `qwen3:8b` in a disposable repository. Qwen Code created an untracked sandbox proof file, the Evaluator inspected it, the candidate `HEAD` remained at the base commit, and the original repository remained clean. A sequential OpenCode/Qwen Code competition also completed from one base commit in two isolated worktrees and selected an eligible winner.

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

Task routing adds another deterministic, history-aware service branch. The existing static scorer runs first, then the adaptive scorer consults SQLite category and recent performance before producing the effective ranking:

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
    -> External worktree -> Adapter -> Execution backend
    -> Docker Agent sandbox -> Safe process runner
    -> Worktree evidence -> Evaluator service -> Verdict
    -> NO COMMIT / NO MERGE
```

Competition reuses that execution pipeline without rerouting a forced Agent:

```text
POST /api/tasks/compete -> Task controller -> Competition service
    -> Analyze once + capture one base commit
    -> executeWithAgent(A) -> Worktree A -> Evaluator A
    -> executeWithAgent(B) -> Worktree B -> Evaluator B
    -> Competition evaluator -> Ranking -> Candidate winner
    -> NO COMMIT / NO MERGE / NO CLEANUP
```

Actual execution results feed the local history store after evaluation:

```text
Execution / competition -> Evaluator result -> History service -> SQLite
    -> Performance service -> Future adaptive routing
```

Human review is the final local Git boundary:

```text
Eligible result -> Stored fingerprint -> Fresh review
    -> Human expected fingerprint -> Target/base checks
    -> Candidate commit -> Local no-ff merge -> Decision + cleanup
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
- Docker Agent execution mounts only the validated candidate worktree and never silently falls back to host.
- Agent containers drop all capabilities, use a non-root user and read-only root, and never receive the Docker socket or Router environment wholesale.
- Dirty repositories and detached `HEAD` states are rejected without automatic stash or commit.
- Evaluator file reads are constrained to the worktree and changed symbolic links are not followed.
- Enabled project scripts run only in disposable Docker snapshots; there is no host npm-script execution path.
- Competition accepts only Agent IDs resolved from the registry; HTTP callers cannot supply an executable command.
- All competitors start from one captured commit and execute sequentially in separate worktrees.
- SQLite statements use bound parameters, runtime database files are ignored by Git, and history stores metadata rather than Agent output or code content.
- Adaptive routing is statistical and deterministic; it never asks an LLM to interpret history or mutates static capability priors.
- Approval accepts only a task ID and expected SHA-256 fingerprint; callers cannot provide a command, branch, worktree, commit, or merge target.
- Candidate evidence is recomputed before staging, and the staged/committed snapshot is verified before local merge.
- Target cleanliness, branch, base `HEAD`, and merge/rebase state are checked without automatic checkout, stash, rebase, hard reset, or clean.
- Cleanup accepts only registered worktrees under the configured project root with the exact expected `agent/<task>-<agent>` branch.
- Approval never pushes a remote; local merge and remote publication remain separate human decisions.

Git worktrees isolate source-control state, while the Phase 11 Docker backends restrict process filesystem access. Docker is now the default Agent backend; host execution remains available only when explicitly configured. Container isolation is still not a formal VM boundary, and Agent bridge networking is broader than an Ollama-only allowlist. Windows host-backend process-tree termination remains best effort.

The local Qwen Code 0.22.3 and `qwen3:8b` combination completed the bounded live validation that created a new documentation file. Existing-file edits that required a read followed by another tool call were not consistently reliable because the model sometimes interpreted tool output as a new instruction. This is a current model/CLI limitation, not a successful general-purpose edit guarantee.

## Local Web Dashboard

The Phase 12 Dashboard replaces manual curl/Thunder Client inspection with a local browser workflow while keeping the backend as the security authority:

```text
Browser -> React Dashboard -> Central API client -> Express backend
    -> Router / Agent execution / Evaluator / Candidate review
    -> Explicit Human Approve or Reject
```

The SPA provides six focused sections:

- **Dashboard** shows backend and Ollama health, the canonical model, Agent availability, recent tasks, and real performance summaries when history exists.
- **Run Task** accepts a multi-line task plus a server-side workspace path, displays deterministic router classification/ranking, and sends either the existing Auto Agent or sequential competition request.
- **Candidates** retrieves fresh Phase 10 review evidence, displays tracked diff as escaped text, lists untracked paths separately, and requires confirmation for fingerprint-bound approval or rejection.
- **History** browses bounded SQLite task metadata and Agent runs without implying that raw stdout or diffs were stored.
- **Performance** shows global, recent, and category-weighted Agent statistics from existing Phase 9 endpoints.
- **System** gives a read-only view of local models, Agent host detection, effective runtime, and sandbox capability.

The Dashboard does not enable Agent execution, change configuration, install models/Agents, push Git remotes, or make backend approval decisions. An evaluation pass and a competition winner remain candidate evidence—not a merge. Approval sends exactly the fingerprint returned by the current review and never retries a conflict automatically. A `candidate_changed`, `stale_base`, dirty-target, or wrong-branch conflict requires the human to refresh and review again.

Phase 12 intentionally uses ordinary HTTP request/response loading states. It does not include SSE, WebSockets, live Agent output, job cancellation, or a task queue. Those are later-phase concerns.
