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

Git worktrees isolate repository state but do not sandbox the host process. A live Qwen Code run demonstrated this by writing a hallucinated absolute path outside the worktree; the artifact was removed and Qwen execution now uses its installed Docker sandbox. OpenCode and Aider remain host-backed in Phase 6, process-tree termination on Windows is best effort, and Phase 11 will introduce the generalized sandbox backend.

The final `qwen3:8b` validation completed a bounded single-write documentation task. Multi-tool existing-file edits were not consistently reliable with Qwen Code 0.22.3 because the model sometimes interpreted a tool result as a new instruction, so this phase does not claim reliable general-purpose editing for that model and CLI combination.
