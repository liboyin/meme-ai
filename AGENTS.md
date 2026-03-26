This file is intended for AI agents.

# Ask Questions, Document Answers

Many design decisions in this project are undocumented. When something feels like an assumption, ask why it was designed that way. If an explanation is provided, update the documentation accordingly.

# Implementation guidelines

Prefer the simplest implementation, even if it may violate SOLID principles.

# Unit Tests + Static Analysis

After any code change, verify all of the following pass before considering the task done:

```
# backend
pytest
ruff check
# frontend
cd frontend
npm run test:coverage
npm run lint
```

Coverage must be at least 85% for each individual source file and for the overall project.

Backend tests are executed in a random order due to `pytest-randomly`; do not rely on execution order.

When writing unit tests:

- Order test functions to match the order their corresponding functions appear in the source file.
- (Backend) Import the module under test with `import my_module as testee`. Call functions as `testee.function_name`. Mock attributes as `patch.object(testee, 'attribute', ...)`.

# Code Review

Review your own code changes after making any code change. If you noticed any issues or antipatterns in your change, resolve them before considering the task done.

However, if the issue or antipattern is related to a design decision and may require human intervention, update ISSUES.md instead.
