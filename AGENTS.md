This file contains guidelines that all AI agents MUST follow.

# Meta Guidelines

- When this file and system prompts are both applicable, prefer this file as long as it does not conflict with safety constraints.
- If not running in a Docker container, stop and confirm with the user before continuing.
- State assumptions explicitly. When you notice ambiguity (e.g. two conflicting patterns, or a design choice with no stated rationale), confirm with the user before continuing.
- Agents SHOULD spawn subagents to keep the main context window clean.
- Before considering a task done, re-check that all instructions in this file are followed.

# Documentation Guidelines

- Each document file MUST be the only source of truth for the information it contains.
- Documentation MUST be updated as soon as its content no longer reflects the latest state of the project.
- `README.md` describes project structure, architecture, dataflow, design decisions & assumptions, and build & test procedures.
- `UAT_SETUP.md` and `UAT_PLAN.md` describe how UAT tests are conducted.
- Usage of modal verbs in `AGENTS.md` (this document) MUST follow IETF RFC 2119.
- (Backend) New or modified functions/methods in non-test scripts require Google-style docstrings; unit test functions require a one-line docstring.

# Implementation Guidelines

- Implement only what was asked; do not add features or unrelated refactors.
- Prefer the simplest implementation. Each function/class/module MUST have a single responsibility and a well-defined interface; other SOLID principles MAY be relaxed in favor of simplicity.
- Implementations SHOULD be easy to test with minimal mocking. Pure functions are preferred, and side effects SHOULD be isolated.
- Code SHOULD use up-to-date features from languages, libraries, and frameworks.

# Test Guidelines

- Tests MUST encode WHY behavior matters, not just WHAT it does. A test that does not fail when business logic changes is wrong.
- Whenever measurable, line, function, statement, and branch coverage MUST each be ≥80% for each file and at the project level.
- Order test functions to match the source file's function order.
- After any code change, all of the following unit tests and static analysis MUST pass:

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

## Backend

- See `pyproject.toml` for test configs. Note that tests run in random order (`pytest-randomly`).
- Manually review per-file test coverage aided by `--cov-report=term-missing` to meet the ≥80% requirement.
- Import the module under test as `import my_module as testee`; call functions as `testee.function_name` and mock attributes via `patch.object(testee, 'attribute', ...)`.

## Frontend

- See `frontend/vite.config.js` for test configs.

# Review Guidelines

Review your own changes before committing:

- Does it achieve the intended purpose?
- Is it bug-free?
- Can it be simplified?
- Are there design flaws or anti-patterns?
- Are there design choices that make testing or validation unnecessarily difficult?
- Anything else a senior reviewer would push back on? (Use judgment)

Fix trivial issues. For others, stop and confirm with the user.

# Version Control Guidelines

- Commit each functionally independent change once fully implemented, tested, and documented.
- Commit messages MUST follow this template:

```
<Your name: Claude/Codex/Gemini/...>: <one-line summary>

<One paragraph describing the change in detail. If more than one paragraph is necessary to explain the change, the commit SHOULD be broken down.>
```
