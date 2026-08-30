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
    → Agent changes → Git status + tracked diff
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

After execution, the service reads worktree status, tracked diff, and `HEAD`. A changed `HEAD` is reported as an unexpected auto-commit and fails the execution result. Worktrees are deliberately retained because evaluation and human approval have not been implemented yet.

Git worktrees isolate repository state but do not sandbox the host process. A live Qwen Code run demonstrated this by writing a hallucinated absolute path outside the worktree; the artifact was removed and Qwen execution now uses its installed Docker sandbox. OpenCode and Aider remain host-backed in Phase 6, process-tree termination on Windows is best effort, and Phase 11 will introduce the generalized sandbox backend.

The final `qwen3:8b` validation completed a bounded single-write documentation task. Multi-tool existing-file edits were not consistently reliable with Qwen Code 0.22.3 because the model sometimes interpreted a tool result as a new instruction, so this phase does not claim reliable general-purpose editing for that model and CLI combination.
