This file is intended for AI agents.

# Meta Guidelines

- If not running in a Docker container, stop and confirm with the user before continuing.
- For multi-step plans or multiple isolated subtasks, spawn subagents.

# Documentation Guidelines

- `README.md` describes project architecture, dataflow, and design decisions for both humans and AI agents.
- If a design decision feels like an assumption, ask the user and record the explanation in `README.md`.
- New or modified functions/methods in non-test scripts require Google-style docstrings; unit test functions require a one-line docstring.

# Implementation Guidelines

- Prefer the simplest implementation, even if it violates SOLID principles.
- Break changes into small, functionally isolated chunks; commit as you go. Commit messages follow this template:

```
<Your name: Claude/Codex/Gemini/...>: <one-line summary>

<One paragraph describing the change in detail>
```

# Test Guidelines

After any code change, all of the following must pass before the task is considered done:

```bash
# backend
uv run --group dev pytest
uv run --group dev mypy
uv run --group dev ruff check backend
# frontend
cd frontend
npm run test:coverage
npm run lint
```

Backend coverage must be at least 85% overall (enforced by `pytest`). Frontend thresholds are configured in `vite.config.js`.

Backend tests run in random order (`pytest-randomly`); do not rely on execution order.

When writing unit tests:

- Order test functions to match the source file's function order.
- (Backend) Import the module under test as `import my_module as testee`; call functions as `testee.function_name` and mock attributes via `patch.object(testee, 'attribute', ...)`.

# Review Guidelines

Review your own changes before committing:

- Does it achieve the intended purpose?
- Is it bug-free?
- Are there design flaws or anti-patterns?
- Can it be simplified?

Fix trivial issues. For others, stop and confirm with the user.
