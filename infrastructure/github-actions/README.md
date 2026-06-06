# GitHub Actions

The live pipeline is `.github/workflows/ci.yml` (GitHub only discovers
workflows there). This folder documents the pipeline design.

## Stages (spec)

| #   | Stage             | Job(s)                                  | Gate                                  |
| --- | ----------------- | --------------------------------------- | ------------------------------------- |
| 1   | Install           | `install`                               | lockfile resolves                     |
| 2   | Lint              | `lint`                                  | ESLint (`no-explicit-any`) + Prettier |
| 3   | Unit Tests        | `unit-tests`                            | jest green, >= 80% coverage on core   |
| 4   | Integration Tests | `integration-tests`                     | Postgres/Redis-backed suites + pytest |
| 5   | Cypress Tests     | `cypress`                               | e2e against the booted platform       |
| 6   | Build             | `build`                                 | full monorepo compiles                |
| 7   | Docker Build      | `docker-build`, `docker-build-frontend` | all images build                      |
| 8   | Security Scan     | `security-scan`                         | no critical vulns (npm audit + Trivy) |
| 9   | Deploy            | `deploy` (main only, env-protected)     | all gates green                       |

## Notes

- The coverage gate is enforced in `packages/shared-utils/jest.config.cjs`
  (`coverageThreshold`), where the trading rule core lives.
- The Cypress stage boots services without Kafka; engines degrade to REST
  polling by design, which keeps the e2e job fast and hermetic.
- The ml-engine Docker image (torch download) is intentionally excluded from
  PR CI; build it in the deploy stage or a nightly workflow.
