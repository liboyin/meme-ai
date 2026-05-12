This file is intended for AI agents.

# Documentation Guidelines

- `README.md` describes project architecture, dataflow, and design decisions for both humans and AI agents.
- When a design decision feels like an assumption, ask why and update documentation if an explanation is provided.
- All new & modified functions/methods in non-test scripts must have Google-style docstrings; unit test functions must have a one-liner docstring.

# Implementation Guidelines

- Prefer the simplest implementation, even if it violates SOLID principles.
- For multi-step plans or multiple isolated changes, implement in subagents.
- Break changes into small, functionally isolated chunks. Commit as you go. Commit messages must follow the following template:

```
<Your name: Claude/Codex/Gemini/...>: <one-line summary>

<One paragraph description of the change in detail>
```

# Unit Tests + Static Analysis

After any code change, verify all of the following pass before considering the task done:

```
# backend
uv run --group dev pytest
uv run --group dev mypy
uv run --group dev ruff check backend
# frontend
cd frontend
npm run test:coverage
npm run lint
```

Backend coverage must be at least 85% overall (enforced by pytest). Frontend coverage thresholds are configured in vite.config.js.

Backend tests are executed in a random order due to `pytest-randomly`; do not rely on execution order.

When writing unit tests:

- Order test functions to match the order their corresponding functions appear in the source file.
- (Backend) Import the module under test with `import my_module as testee`. Call functions as `testee.function_name`. Mock attributes as `patch.object(testee, 'attribute', ...)`.

# Code Review

Review your own code changes after making any code change. If you noticed any issues or antipatterns in your change, resolve them before considering the task done.

However, if the issue or antipattern is related to a design decision and may require human intervention, update ISSUES.md instead.
