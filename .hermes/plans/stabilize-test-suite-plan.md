# Squad Test Suite Stabilization Plan

**Goal:** Stabilize the test suite on macOS by fixing environment issues and flaky timeout-dependent tests to establish a 100% green baseline.
**Architecture:** 
1. Install missing Playwright browser binaries to satisfy the Aspire integration tests.
2. Moderate strict test timeouts in CLI packaging smoke tests and Hostile QA acceptance harnesses to handle high-CPU local load gracefully.
3. Configure Vitest sequential test execution for `SquadObserver` to prevent global OpenTelemetry state collisions.
**Tech Stack:** Node.js (>= 22.5), Vitest, Playwright, Git, OpenTelemetry.
**Project Directory:** /Users/joeshirey/Code/GitHub/squad

---

### Task 1: Install Playwright Browsers

**Objective:** Install Playwright headless Chromium to resolve the browser startup error in Aspire integration tests.

**Files:**
- Modify: None (run-only)

**Dispatch Prompt:**
```
Please download the required Playwright browser binaries so that local Playwright-based tests can start.
Run the command:
npx playwright install chromium
Verify that the command completes successfully.
```

**Scope:** run commands
**Timeout:** 300

**Verification:**
Run: `npx vitest run test/aspire-integration.test.ts` (Note: tests are skipped if dashboard is not active, but the browser type launch error will be resolved).
Expected: All active tests PASS or are cleanly skipped (no browser launch errors).

---

### Task 2: Bump Timeout in CLI Smoke Tests

**Objective:** Increase the process timeout in `test/cli-packaging-smoke.test.ts` from 2000ms to 10000ms to prevent load-induced test failures on slower systems.

**Files:**
- Modify: `test/cli-packaging-smoke.test.ts`

**Dispatch Prompt:**
```
In `test/cli-packaging-smoke.test.ts`, find the `runCommand` helper function.
Locate the `execFileSync` options block where the `timeout` is hardcoded to `2000` (ms).
Increase this timeout to `10000` (10 seconds) so that slower execution or system load doesn't cause false timeout failures.

Keep all other parameters, behavior, and output format exactly identical.
```

**Scope:** edit
**Timeout:** 180

**Verification:**
Run: `npx vitest run test/cli-packaging-smoke.test.ts`
Expected: PASS (all 32 tests)

---

### Task 3: Sequential Execution for Squad Observer Tests

**Objective:** Enforce sequential test execution in `test/squad-observer.test.ts` using Vitest's `describe.sequential` to avoid global OpenTelemetry provider collisions during concurrent runs.

**Files:**
- Modify: `test/squad-observer.test.ts`

**Dispatch Prompt:**
```
In `test/squad-observer.test.ts`, find the outer `describe('SquadObserver', ...)` block and the `describe('classifyFile', ...)` block.
Change the `describe('SquadObserver', ...)` block to `describe.sequential('SquadObserver', ...)` to guarantee that the tests within this block run sequentially. This prevents global OTel provider setup/teardown races during concurrent Vitest runs.
```

**Scope:** edit
**Timeout:** 180

**Verification:**
Run: `npx vitest run test/squad-observer.test.ts`
Expected: PASS

---

### Task 4: Bump Exit Timeout in Hostile Acceptance Harness

**Objective:** Increase the exit timeout in `test/acceptance/steps/hostile-steps.ts` from 5000ms to 15000ms to handle slow diagnostic executions cleanly.

**Files:**
- Modify: `test/acceptance/steps/hostile-steps.ts`

**Dispatch Prompt:**
```
In `test/acceptance/steps/hostile-steps.ts`, locate the `When I run "(.+)" with that terminal size` step registration.
Inside this function, find the `harness.waitForExit(5000)` call.
Change the timeout to `15000` (15 seconds) so that slow doctor checks or other diagnostic commands can complete within the harness under local environment latency.
```

**Scope:** edit
**Timeout:** 180

**Verification:**
Run: `npx vitest run test/acceptance/hostile.test.ts`
Expected: PASS
