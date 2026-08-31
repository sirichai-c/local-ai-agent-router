# Backend Architecture

Local AI Agent Router uses a layered Express backend. Routes map URLs, controllers handle HTTP validation and responses, and services contain application behavior.

## Current request flows

```text
GET /health
    → Health route → Health controller

POST /api/chat
    → Ollama route → Ollama controller → Ollama service → Local Ollama

GET /api/agents
    → Agent route → Agent controller → Registry → PATH detection

POST /api/router/analyze
    → Router route → Router controller → Router service
    → Classifier + Registry + Scorer → Ranking

POST /api/router/plan
    → Router route → Router controller → Planner service
    → Router service → Selected agent → Adapter registry
    → Specific adapter → Invocation plan
    → NO EXECUTION

POST /api/tasks/execute
    → Task route → Task controller → Agent executor
    → Router → Execution gate → Git repository validation
    → Worktree service → Adapter → Safe process runner
    → Agent changes → Git status + tracked diff + untracked paths
    → Evaluator service → Deterministic score and verdict
    → NO COMMIT / NO MERGE
```

### Multi-agent competition flow

```text
POST /api/tasks/compete
    -> Task route -> Task controller -> Competition service
    -> Analyze task once -> Capture repository/base commit once
    -> Sequential forced-agent execution in separate worktrees
    -> Independent Phase 7 evaluations -> Competition evaluator
    -> Ranking + candidate winner -> NO COMMIT / NO MERGE / NO CLEANUP
```

## Adapter boundary

Every adapter returns a data-only invocation:

```text
{
  command: string,
  args: string[],
  cwd: absoluteWorkspacePath,
  env: object
}
```

The task is one element in `args`; adapters never concatenate it into a shell command. The planner only reads workspace metadata to confirm that the path exists and is a directory. It never writes to the workspace or starts an agent process.

OpenCode and Qwen Code are locally verified. Qwen Code 0.22.3 runs through its fixed Node entry point and uses the CLI's verified Docker sandbox. Aider follows its current official documentation but remains locally unverified because that CLI is not installed.

On Windows, the registry keeps the logical CLI command for metadata while resolving a separate `executionCommand`. Only a verified native executable is considered available for `spawn(..., { shell: false })`; npm `.cmd` shims are not routed through a shell.

## Worktree execution boundary

```text
Original repository
       |
       | clean branch + captured HEAD
       |
       +-----------------------------+
       |                             |
   target branch          agent/<task>-<agent>
                                     |
                                     v
                              External worktree
                                     |
                                     v
                                Coding agent
                                     |
                                     v
                                  Changes

No target checkout
No router commit
No merge
```

The executor validates the original repository before allocating a unique worktree. The adapter receives the worktree path as `cwd`, and the process runner accepts only known command basenames. Task text remains a single argument, `shell` is always disabled, and stdout/stderr share a bounded capture budget. Qwen Code adds its Docker sandbox and a task-local `QWEN_HOME`, so its file tools receive the worktree plus an empty runtime directory instead of the user's real Qwen profile. The container reaches Ollama on the Windows host through `host.docker.internal`; Ollama is not exposed to the LAN.

After execution, the service reads worktree status, tracked diff, untracked paths, and `HEAD`. A changed `HEAD` is reported as an unexpected auto-commit and fails the execution result. The evaluator then produces independent evidence and a verdict. Worktrees are deliberately retained because human approval and cleanup have not been implemented yet.

## Evaluator boundary

```text
Coding Agent
    |
    v
Worktree Changes
    |
    v
Evaluator Service
    +-------------+-------------+-------------+
    |             |             |             |
    v             v             v             v
Diff          Static        Project        Scoring
Evaluator     Evaluator     Evaluator      Evaluator
    |             |             |             |
    +-------------+-------------+-------------+
                         |
                         v
              pass / warning / fail
```

The diff evaluator counts both tracked and untracked files, measures only the tracked diff bytes, checks sensitive filenames, and rejects paths that resolve outside the worktree. Untracked contents are not represented as a unified patch, but supported untracked JavaScript and JSON files are still safely validated. If any sensitive path is detected, the API omits the raw tracked diff and Agent output and marks them as redacted.

The static evaluator uses the allowlisted Node executable with `--check` for changed JavaScript and parses JSON as data. It skips deleted and unsupported files, refuses changed symbolic links, and never imports application modules.

The project evaluator parses `package.json` and reports whether `test`, `lint`, and `build` scripts exist. Phase 7 never executes these Agent-controlled scripts on the host. `EVALUATOR_RUN_PROJECT_SCRIPTS=false` is the default, and host execution remains unavailable even when requested until the Phase 11A sandbox is implemented.

The score evaluator begins at 100 and applies documented deterministic deductions. Critical sensitive paths, unsafe paths, timeouts, and unexpected commits are hard failures. Changed-file syntax failures also force a fail verdict. Skipped project scripts do not reduce the score.

Execution status is mapped separately from the evaluator verdict:

```text
process success + pass      -> completed
process success + warning   -> completed_with_warnings
process success + fail      -> evaluation_failed
process/timeout/commit fail -> failed
```

## Competition boundary

```text
                         Task
                          |
                     Analyze Once
                          |
                    Same Base Commit
                          |
             +------------+------------+
             |                         |
             v                         v
          Agent A                   Agent B
             |                         |
         Worktree A                Worktree B
             |                         |
         Evaluator A               Evaluator B
             |                         |
             +------------+------------+
                          |
                          v
                Competition Evaluator
                          |
                       Ranking
                          |
                        Winner
                          |
                    Candidate Only
```

The competition service asks the deterministic router for one analysis, validates the original repository once, and captures one `baseCommit`. It passes registry-backed Agent metadata and that repository snapshot to the Agent executor's internal `executeWithAgent` method. That method does not call the router again, so an explicitly selected candidate cannot be replaced by another Agent.

Worktree creation accepts a caller-provided competition ID while retaining automatic IDs for the single-Agent endpoint. Branches therefore share `agent/<competition-id>-` but keep separate Agent suffixes and paths. Candidate execution uses a sequential loop because parallel access to the same Ollama/GPU would distort timing and create resource contention.

After every run, the existing Phase 7 evaluator supplies a 0-100 quality score. The competition evaluator combines 70% quality, 20% router suitability, and 10% relative speed. Only `completed` and `completed_with_warnings` entries are eligible; failed entries remain ranked for diagnosis but cannot win. Deterministic ties prefer competition score, evaluation score, router score, shorter duration, then lexicographic Agent ID.

Candidate results retain untracked-file evidence separately from tracked-diff metadata. No synthetic full patch is created, so the architecture does not imply that `git diff` contains untracked content. Candidate branches and worktrees remain after the response. Phase 8 performs no commit, merge, approval, or automatic cleanup.

## Persistent history and adaptive routing

```text
                   Task
                    |
             Task Classifier
                    |
        +-----------+-----------+
        |                       |
        v                       v
 Static Capability         SQLite History
        |                 +-----+-----+
        |                 |           |
        |                 v           v
        |             Category      Recent
        |             History       History
        |                 |           |
        +-----------------+-----------+
                          |
                          v
                    Adaptive Scorer
                          |
                          v
                      Agent Ranking
                          |
                          v
                       Execution
                          |
                          v
                       Evaluator
                          |
                          v
                   Persistent History
```

The database service owns one lazily opened application-level `better-sqlite3` connection. File databases use WAL mode, foreign keys, a busy timeout, and an idempotent version-1 schema. The history service wraps task plus category creation in a transaction and uses prepared statements for every value originating outside the static schema. Runtime `.db`, `.db-shm`, and `.db-wal` files are never committed.

The schema stores one `tasks` record for each actual enabled single execution or competition, nonzero classification weights in `task_categories`, and one metadata-only `agent_runs` record per attempted Agent. Output, diffs, source content, environment data, and secrets are not persisted. Analyze, plan, execution-disabled, and insufficient-competitor requests do not pollute history.

Performance queries include failures: a failed process with no evaluator score contributes zero quality instead of disappearing from reliability statistics. Category performance uses one category row per task and distinct run IDs, with each evaluation weighted by that task's category score. Recent performance takes the latest configured number of distinct runs.

The adaptive scorer starts with the existing static score. Category and recent components become eligible only after the configured minimum sample count; missing categories are ignored rather than treated as zero. Available configured weights are renormalized, the result is clamped to 0-100, and deterministic tie-breaking remains unchanged. Static priors stay in configuration and are never self-modified.

Competition analysis remains a snapshot. It analyzes once and keeps those routing scores through every candidate run. Candidate history is written only after all executions and comparison complete, so newly stored results affect future tasks rather than changing the current contest midway.

History and performance requests retain the normal layered flow:

```text
History / performance route -> Controller -> Service
    -> Prepared SQLite query -> Structured metadata response
```

## Human review and approval boundary

```text
                   Agent Result
                        |
                     Evaluator
                        |
                   Candidate
                        |
               Candidate Fingerprint
                        |
                  Human Review
                     /      \
                    /        \
                Reject      Approve
                  |            |
               Cleanup     Revalidate
                               |
                         Same fingerprint?
                               |
                         Same base HEAD?
                               |
                         Target clean?
                               |
                            Commit
                               |
                         Local no-ff merge
                               |
                          Local target
                               |
                            Cleanup
```

Candidate tracking begins after execution and evaluation. Only `completed` and `completed_with_warnings` runs receive approval fingerprints. A single task uses its sole eligible run; a competition uses the same eligibility and deterministic tie policy as Phase 8 and validates the stored winner ID against the derived winner.

The fingerprint service hashes the base commit, current worktree `HEAD`, normalized Git status, tracked diff, sorted untracked paths, and streamed hashes of safe regular untracked files. It also creates an internal index-independent content snapshot used to verify the state again after staging. Lexical traversal, real-path escape, symbolic links, non-regular files, truncated tracked evidence, and mutation during streaming prevent approval.

Review resolves the task ID to database-owned repository, branch, and worktree metadata. It requires the exact expected `agent/<task>-<agent>` name and worktree-root location, confirms Git still registers that pair, then recomputes evidence. It never replaces the stored fingerprint when a candidate changes.

Approval requires the human-provided stored fingerprint and a matching fresh fingerprint. Before Git mutation it confirms the original repository is clean, on the recorded target branch, at the recorded base commit, and has no merge or rebase in progress. After staging it compares the content snapshot again, rejects unstaged/untracked races, creates a controlled candidate commit, verifies ancestry and the committed patch, and rechecks the target immediately before merging the immutable candidate commit. No Agent or general execution endpoint can call this service indirectly.

The version-2 SQLite migration adds target/base/decision/commit/winner metadata to `tasks` and `candidate_fingerprint` to `agent_runs` with idempotent `ALTER TABLE` operations. Existing Phase 9 rows remain intact but have null approval fields and cannot be silently approved.

Successful approval records `approved` and `merged` metadata before validated worktree cleanup. A cleanup warning never rolls back a valid local merge. Rejection records `rejected` before force-removing validated disposable worktrees and branches, and never mutates the target branch. No Phase 10 operation pushes a remote.

## Project evaluation sandbox

```text
Candidate worktree (read only to snapshot service)
        |
        v
Safe regular-file snapshot (no .git, node_modules, or symlinks)
        |
        +--> dependency install container -- network: bridge
        |       npm ci/install --ignore-scripts
        |
        +--> npm test  container -- network: none
        +--> npm lint  container -- network: none
        +--> npm build container -- network: none
        |
        v
Structured project evidence -> Phase 7 scoring
```

The Router invokes Docker only through the safe process runner with fixed arguments. Evaluation containers run as UID/GID 1000, use a read-only root filesystem plus bounded `/tmp`, drop all capabilities, enable `no-new-privileges`, and apply configured memory, CPU, PID, timeout, and output bounds. The only writable host mount is a validated path beneath `.sandbox-runs`; Docker socket, user home, Router environment, candidate Git metadata, and host dependency trees are not mounted.

Dependency setup is the only stage with Docker bridge networking. Lifecycle scripts are disabled. Untrusted project scripts always run with `--network none`, and enabled evaluation never falls back to running npm scripts directly on Windows.

Git worktrees isolate repository state but do not sandbox the host process. A live Qwen Code run demonstrated this by writing a hallucinated absolute path outside the worktree; the artifact was removed and Qwen execution now uses its installed Docker sandbox. OpenCode and Aider remain host-backed in Phase 6, process-tree termination on Windows is best effort, and Phase 11 will introduce the generalized sandbox backend.

The final `qwen3:8b` validation completed a bounded single-write documentation task. Multi-tool existing-file edits were not consistently reliable with Qwen Code 0.22.3 because the model sometimes interpreted a tool result as a new instruction, so this phase does not claim reliable general-purpose editing for that model and CLI combination.
