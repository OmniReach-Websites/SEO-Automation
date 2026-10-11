# Test Layout

- `unit/`: deterministic module and policy tests.
- `integration/`: interactions across repository modules or disposable dependencies.
- `e2e/`: outside-in behavior through Playwright's runner.
- Later goals add `security/`, `contracts/`, `deployment/`, and `load/` suites as their behavior exists.

Tests use fictional or synthetic data only. Empty placeholder tests and silent skips are prohibited.
