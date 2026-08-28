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

OpenCode is locally verified. Qwen Code and Aider adapters follow their current official documentation but remain locally unverified because those CLIs are not installed.
