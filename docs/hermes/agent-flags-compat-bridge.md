# Case Study: Squad Watch Mode Agent/Copilot Flags Compatibility Bridge

This case study documents a real-world application of the **Dual-Field Compatibility Bridge** pattern used during custom fork maintenance of the `squad` repository.

---

## 1. Background & Context

* **Repository**: `squad` (a programmable multi-agent runtime).
* **The Customization**: To fully decouple the runtime from GitHub Copilot and support other models (such as Anthropic Claude and Google Gemini), the custom fork refactored and generalized `copilotFlags` to `agentFlags` on all key interfaces and configuration options.
* **The Upstream Update**: The upstream parent repository maintained the `copilotFlags` property and eventually introduced a centralized execution utility (`agent-spawn.ts`) and updated 6 capability modules (e.g., `execute.ts`, `retro.ts`, `wave-dispatch.ts`) to read `context.copilotFlags` from the runtime `WatchContext`.

---

## 2. The Problem: Silent Merge Success with Compilation Failure

When performing a standard upstream synchronization merge on the `dev` branch:

1. The merge completed with **zero git merge conflicts** because git cleanly auto-merged the files.
2. However, the subsequent compilation check (`npm run build`) failed immediately with static type errors in the new/updated upstream files:

   ```bash
   src/cli/commands/watch/agent-spawn.ts(83,15): error TS2339: Property 'copilotFlags' does not exist on type 'WatchContext'.
   src/cli/commands/watch/agent-spawn.ts(84,26): error TS2339: Property 'copilotFlags' does not exist on type 'WatchContext'.
   ```

This happened because:

* Our local fork's `WatchContext` interface in `types.ts` was edited to only define `agentFlags?: string;`.
* Git safely kept our modified `types.ts` during the merge, but introduced upstream's new files which assumed `copilotFlags` was always present.

---

## 3. The Solution: Zero-Friction Dual-Field Bridge

Rather than reverting our custom provider-agnostic `agentFlags` or manually altering dozens of upstream capability files (which would introduce massive merge friction on the next sync), we built a compatibility bridge.

### Step A: Declare Both Properties in Types (`types.ts` & `config.ts`)

We updated `WatchContext` and `WatchConfig` to allow both fields as optional:

```typescript
// packages/squad-cli/src/cli/commands/watch/types.ts
export interface WatchContext {
  // ...
  agentFlags?: string;    // Our generalized option
  copilotFlags?: string;  // Upstream-compatible option
}

// packages/squad-cli/src/cli/commands/watch/config.ts
export interface WatchConfig {
  // ...
  agentFlags?: string;
  copilotFlags?: string;
}
```

### Step B: Sync Property Values at Config Load-Time (`config.ts`)

We updated the raw configuration normalizer. If either property is found, both are initialized with that value, ensuring they remain in lockstep:

```typescript
// packages/squad-cli/src/cli/commands/watch/config.ts
function normalizeFileConfig(raw: Record<string, unknown>): Partial<WatchConfig> {
  const result: Partial<WatchConfig> = {};
  // ...
  
  if (typeof raw['agentFlags'] === 'string') {
    result.agentFlags = raw['agentFlags'];
    result.copilotFlags = raw['agentFlags']; // Sync to legacy key for upstream
  }
  
  // Backward compatibility: accept copilotFlags as alias for agentFlags
  if (typeof raw['copilotFlags'] === 'string') {
    result.copilotFlags = raw['copilotFlags'];
    if (!result.agentFlags) {
      result.agentFlags = raw['copilotFlags']; // Sync to custom key
    }
  }
  
  return result;
}
```

During configuration merging (`loadWatchConfig`), we resolved both fields:

```typescript
    agentFlags: cliOverrides.agentFlags ?? fileConfig.agentFlags ?? DEFAULTS.agentFlags,
    copilotFlags: cliOverrides.copilotFlags ?? fileConfig.copilotFlags ?? DEFAULTS.copilotFlags ?? cliOverrides.agentFlags ?? fileConfig.agentFlags,
```

### Step C: Populate Both Fields in Context Initialization (`index.ts`)

Finally, we populated both keys in the `baseContext` factory to guarantee that any executing capability (whether upstream or custom) receives its expected flag at runtime:

```typescript
// packages/squad-cli/src/cli/commands/watch/index.ts
const baseContext: WatchContext = {
  teamRoot,
  adapter,
  round: 0,
  roster: roster.map(r => ({ name: r.name, label: r.label, expertise: [] as string[] })),
  config: {},
  agentCmd: config.agentCmd,
  agentFlags: config.agentFlags,
  copilotFlags: config.copilotFlags ?? config.agentFlags, // Bridge fallback
  verbose: config.verbose,
  pidTracker,
};
```

---

## 4. Key Takeaways

1. **Separation of Concerns**: Adding a type-safe alias bridges the gap between customized forks and upstream expectations without polluting the clean provider-agnostic domain logic.
2. **Build-Centric Validation**: A successful git merge is only half the battle. A complete automated synchronization check *must* build compile-checks (`npm run build` or `go build`) and run test suites to catch silent type mismatches introduced by new files.
3. **No Lock-in**: This bridge keeps our custom fork 100% compatible with Claude and Gemini engines (avoiding hard coupling to Copilot) while allowing us to merge upstream developments with zero manual code modifications.
