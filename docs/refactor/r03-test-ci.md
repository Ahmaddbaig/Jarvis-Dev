# R03 test and CI foundation

Status: local quality gate implemented and passing on macOS arm64 on 2026-08-05; hosted runner results begin when this branch is pushed.

## Local gate

`npm run check` runs:

1. ESLint with a checked-in warning budget.
2. The Vitest suite.
3. application TypeScript checking.
4. source-to-security-inventory route validation.

Vitest explicitly excludes generated `.build`, `.next`, `dist-electron`, `release`, and `scripts/dist` trees. This prevents packaged or traced copies of tests from inflating the test count. The canonical baseline remains 3 files and 36 tests.

The first ESLint run exposed 62 legacy errors and 34 warnings. CommonJS script imports are now scoped correctly, two safe lint findings were corrected, and pre-existing React 19 compiler diagnostics are visible as warnings. `docs/refactor/lint-baseline.json` is a per-rule ratchet: ESLint errors, a new warning rule, a per-rule increase, or a total increase fails `npm run lint`. Budgets should only move downward as later slices repair the owning components.

## Hosted matrix

`.github/workflows/ci.yml` defines Linux x64, macOS arm64, and Windows x64 jobs. Each runner installs pinned Node/Python versions, runs the quality gate, builds its native Computer Use helper, builds the Next standalone runtime, compiles Electron source, checks required resources and the local-state denylist, and uploads short-lived native build evidence.

The matrix does not claim release readiness: installer packaging, signing, notarization, hardware voice tests, and recovery/downgrade drills remain later release gates.
