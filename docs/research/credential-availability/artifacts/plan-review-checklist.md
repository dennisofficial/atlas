# Acceptance gate for the implementation plan

This is a planning review checklist, not proof tests have run.

## Verticality and scope

- Slice01 changes actual retry+failure reporting behavior; it is useful without later slices.
- Slice02 prevents repeated calls inside an in-process runtime, covering main/children/utilities, not just a pure unused state machine.
- Slice03 proves two independent runtimes observe the same durable exclusion and safe recovery; no permanent reliance on before-turn refresh.
- Slice04 exposes truthfully waiting/paused/active work and provider controls, including mobile web/TUI; a pure schema or disabled future button is not a delivered slice.
- Slice05 actually switches and resumes a chosen set without replaying completed side effects or silently retargeting pins/defaults.
- Slice06 is explicitly optional; no other slice requires a preapproved fallback policy to be usable.

## Shared semantics

- Exactly one normalized failure meaning feeds retries, availability observations, run failure copy and recovery eligibility.
- Auth rejected vs missing transport/config vs model denied vs budget exhausted vs throttled vs provider/network failure are distinct.
- Scope is explicit: owner/account+replacement revision, model route where appropriate, broader budget only on proven scope. No assumptions all429s are temporary or all403s mean invalid key.
- Credential revision, OAuth authorization lineage, access-token rotation and availability revision have non-overlapping purposes.
- Manual pause cannot be cleared by automatic success/expiry; replaced credential cannot be re-paused by an old failure.
- Auth repair/refresh gets one appropriate chance; one recovery probe after cooldown; bounded all retries/no fallback oscillation.
- Global default and stored selected model remain independent of temporary effective route; actual route/credential recorded honestly.
- Main/agent/utility parity, ongoing/resumed turn admission, cached OAuth gate, local host runtime and detached serve composition are explicit.

## Concurrency and outages

- Finite request-time freshness/admission policy with numbers and API outage behavior. No vague 'refresh as needed'.
- Atomic CAS, failed claimant lease expiry, replacement vs old observation, stale success vs recent failure, two simultaneous pause/probe/actions all have executable tests.
- Availability authority is not a new execution scheduler/checkpoint or provider-secret copy.
- New ports explicitly registered; all runtime+transport slots filled; API dependency rules preserved.
- Blocked model wakes do not spin, flood notices or keep pretend-running agents forever; queued work stays recoverable.
- Provider/reset clocks are injected; provider hint parsing documented/fixture-backed; no arbitrary guessed reset.

## Buildability and release

- Every modified existing file anchored to actually read path:line; every new module has precise responsibility+signature and export/composition points.
- Package scripts exist: root bun install; bun --cwd <package> run test/typecheck; root bun run lint; serve build:serve, web build/build:desktop, TUI binary build explicitly checked.
- DB integration uses real PostgreSQL and actual Prisma8 conventions, not Prisma7 generated-client code. Local test DB prerequisites named.
- Services/previews use declared .atlas/services.yaml. No UI verification claimed in this planning pass.
- Tests cover behavior, not merely helpers; full closure test/typecheck/build and independent review required before later shipping.
- Wire/migration compatibility and serve/TUI/Mac release needs named. Rebase/re-anchor against fresh origin/main before each implementation slice.

## Commands verified from source

- package.json:11-25 root install/typecheck/test/build/lint scripts.
- packages/harness/package.json:15-17: package test uses bun test --timeout30000; preserve timeout when invoking focused specs.
- apps/api/package.json:7-26: api scripts, env wrapper, db migration and test task.
- apps/web/package.json:5-12: bun run build and bun run build:desktop are distinct gates.
- apps/serve/package.json:6-9: bun run build:serve (not generic build).
- CONTRIBUTING.md:14-23,42-49: turbo closure tasks, tests and actual binary build.
- .atlas/services.yaml:1-34: postgres/api/web/storybook/prototype declarations; no server started for planning.
