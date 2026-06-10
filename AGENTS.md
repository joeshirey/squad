# squad (custom fork) — Agent Context

## Project memory (hermes)

Facts captured from prior agent sessions in this repo. Verify against current code before relying on them.

- **This is a custom fork** of upstream `bradygaster/squad`. **Never push or open PRs against the upstream repo — always target this fork (`joeshirey/squad`).**
- **Key customization**: the fork generalizes `copilotFlags` to `agentFlags` across interfaces and configuration to decouple the runtime from GitHub Copilot (supporting Claude, Gemini, etc.). Upstream still uses `copilotFlags`, so upstream syncs require the dual-field compatibility bridge documented in [docs/hermes/agent-flags-compat-bridge.md](docs/hermes/agent-flags-compat-bridge.md) — including upstream's centralized `agent-spawn.ts` utility and the capability modules that read `context.copilotFlags`.
