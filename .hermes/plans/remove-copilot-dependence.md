# Remove Copilot Dependence Implementation Plan

**Goal:** Completely eliminate all compilation and runtime dependencies on GitHub Copilot SDK (`@github/copilot-sdk`), supporting a clean, provider-agnostic multi-agent architecture.
**Architecture:** Delete `copilot-provider.ts`, prune `@github/copilot-sdk` from dependencies, and modify `client.ts` and `provider-factory.ts` to fail-closed/throw errors when the copilot provider is requested.
**Tech Stack:** TypeScript, Node.js (monorepo, workspace)
**Project Directory:** `/Users/joeshirey/Code/GitHub/squad`

---

## Task 1: Cleanly Decouple SDK Code from Copilot Provider

**Objective:** Delete the broken `copilot-provider.ts` file, and update `client.ts` and `provider-factory.ts` to reject Copilot provider requests cleanly rather than attempting to lazy-require or import it.

**Files:**
- Delete: `packages/squad-sdk/src/adapter/providers/copilot-provider.ts`
- Modify: `packages/squad-sdk/src/adapter/client.ts`
- Modify: `packages/squad-sdk/src/adapter/provider-factory.ts`

**Dispatch Prompt:**
```
We are completely removing all copilot SDK dependence from the Squad multi-agent runtime.

Please perform the following steps:
1. Delete the file 'packages/squad-sdk/src/adapter/providers/copilot-provider.ts'.
2. In 'packages/squad-sdk/src/adapter/client.ts':
   - Modify the constructor so that if 'options.provider' is NOT supplied, instead of lazy-requiring and constructing 'CopilotProvider', throw a clean Error:
     "No provider supplied. In this environment, Copilot compatibility is disabled, so a provider must be explicitly specified."
   - Remove any remaining comments or JSDocs referring to CopilotProvider as the default.
3. In 'packages/squad-sdk/src/adapter/provider-factory.ts':
   - Modify the 'copilot' case inside 'createProvider()' to throw an Error:
     "Copilot provider is disabled/removed in this configuration."
   - Remove 'copilot' from the list of valid provider types inside 'mapConfigType()' to keep it clean.

Run all actions non-interactively, ensure there are zero syntax or linting errors, and commit locally as Joe Shirey.
```

**Scope:** read, edit, write, run commands
**Timeout:** 180

**Verification:**
Verify that the `copilot-provider.ts` file is deleted and compile of `squad-sdk` succeeds without finding missing types.

---

## Task 2: Prune Dependency from Package Files

**Objective:** Remove `@github/copilot-sdk` from `packages/squad-sdk/package.json` and regenerate the package-lock.json.

**Files:**
- Modify: `packages/squad-sdk/package.json`
- Modify: `package-lock.json`

**Dispatch Prompt:**
```
Please remove all traces of '@github/copilot-sdk' dependency from the repository packages:

1. In 'packages/squad-sdk/package.json':
   - Under 'dependencies', remove the line:
     "@github/copilot-sdk": "^1.0.4",
2. Run 'npm install' in the repository root to regenerate and reconcile 'package-lock.json' cleanly without copilot-sdk package references.

Run all actions non-interactively, and commit locally as Joe Shirey.
```

**Scope:** read, edit, write, run commands
**Timeout:** 180

**Verification:**
Run: `npm run build`
Expected: SDK compiles cleanly with zero copilot-sdk type errors!

---

## Task 3: Resolve Stale Test Suites

**Objective:** Locate and modify or skip any tests that mock or verify CopilotProvider or Copilot SDK behavior, ensuring the entire test suite passes perfectly.

**Files:**
- Modify: Any files in `test/` that import or mock `@github/copilot-sdk` or `copilot-provider`.

**Dispatch Prompt:**
```
Check for any tests that mock or depend on '@github/copilot-sdk' or 'copilot-provider.ts':
- Scan 'test/' files for references.
- For tests that verify copilot-provider (e.g. 'client.test.ts', 'integration.test.ts', 'session-adapter.test.ts'), modify or skip/delete them since copilot-provider has been completely decommissioned and is no longer supported in the codebase.
- Verify that the entire workspace test suite ('npm test' or equivalent) passes completely green.

Run all actions non-interactively, and commit locally as Joe Shirey.
```

**Scope:** read, edit, write, run commands
**Timeout:** 180

**Verification:**
Run: `npm test`
Expected: PASS
