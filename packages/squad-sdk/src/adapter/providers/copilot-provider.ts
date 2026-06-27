/**
 * Copilot Provider
 *
 * Wraps the GitHub Copilot SDK (`@github/copilot-sdk`) `CopilotClient` as a
 * SquadProvider implementation.
 *
 * This file is intentionally decoupled from `@github/copilot-sdk` at build
 * time: the package is NOT a dependency and is NOT present in node_modules.
 * Instead, the SDK is loaded lazily at runtime via a dynamic `import()` from
 * the *user's* environment. The types below are minimal local declarations so
 * the file compiles without the SDK's type definitions.
 *
 * If the SDK cannot be loaded (it is not installed), the provider falls back to
 * probing for the `copilot` CLI binary in PATH and fails gracefully with an
 * actionable error message rather than crashing on a hard import.
 *
 * @module adapter/providers/copilot-provider
 */

import { execFileSync } from 'node:child_process';
import type { SquadProvider } from '../provider.js';
import type {
  SquadSessionConfig,
  SquadSession,
  SquadSessionEvent,
  SquadSessionEventHandler,
  SquadSessionEventType,
  SquadSessionMetadata,
  SquadGetAuthStatusResponse,
  SquadGetStatusResponse,
  SquadModelInfo,
  SquadMessageOptions,
  SquadClientEventType,
  SquadClientEvent,
  SquadClientEventHandler,
} from '../types.js';

// ---------------------------------------------------------------------------
// Lightweight, dependency-free Copilot SDK bridge types
// ---------------------------------------------------------------------------
//
// These minimal declarations stand in for `@github/copilot-sdk` so this file
// type-checks without the SDK installed. The real shapes are richer; we only
// declare the surface this provider actually touches and lean on `any` for the
// rest to stay loosely coupled.

/** Construction options forwarded to the real `CopilotClient`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CopilotClientConfig = Record<string, any>;

/** Minimal structural interface for the SDK's `CopilotClient`. */
interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSession(config: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resumeSession(sessionId: string, config: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listSessions(): Promise<any[]>;
  deleteSession(sessionId: string): Promise<void>;
  getLastSessionId(): Promise<string | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listModels(): Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAuthStatus(): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStatus(): Promise<any>;
  ping(message?: string): Promise<{ message: string; timestamp: number; protocolVersion?: number }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(...args: any[]): () => void;
}

/** Constructor signature exposed by `@github/copilot-sdk`. */
type CopilotClientCtor = new (config: CopilotClientConfig) => CopilotClientLike;

/** Shape of the lazily-imported `@github/copilot-sdk` module. */
interface CopilotSdkModule {
  CopilotClient: CopilotClientCtor;
}

/**
 * Check whether the `copilot` CLI binary is resolvable on PATH.
 *
 * Used as a graceful-failure signal: when the SDK package is not installed we
 * still want to give a precise diagnostic about whether the Copilot CLI itself
 * is set up in the environment.
 */
function isCopilotBinaryAvailable(): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(probe, ['copilot'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lazily load `@github/copilot-sdk` from the user's environment.
 *
 * Throws an actionable error if the SDK is not installed, distinguishing the
 * case where the `copilot` CLI binary is present (SDK missing) from the case
 * where neither is available.
 */
async function loadCopilotSdk(): Promise<CopilotSdkModule> {
  try {
    // Dynamic import keeps `@github/copilot-sdk` out of build-time deps and
    // node_modules; it is resolved from the caller's environment at runtime.
    // The specifier is held in a variable (not a string literal) so the
    // TypeScript compiler does not attempt to statically resolve the absent
    // module and emit TS2307.
    const specifier = '@github/copilot-sdk';
    const sdk = (await import(specifier)) as unknown as CopilotSdkModule;
    if (!sdk?.CopilotClient) {
      throw new Error('module did not export "CopilotClient"');
    }
    return sdk;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (isCopilotBinaryAvailable()) {
      throw new Error(
        'The Copilot provider requires the "@github/copilot-sdk" package, which is not installed. ' +
          'The "copilot" CLI binary was found on PATH, but the SDK bridge could not be loaded. ' +
          'Install "@github/copilot-sdk" in your environment to enable the Copilot provider. ' +
          `(load error: ${reason})`,
      );
    }
    throw new Error(
      'The Copilot provider is unavailable: neither the "@github/copilot-sdk" package nor the ' +
        '"copilot" CLI binary could be found. Install "@github/copilot-sdk" and the GitHub Copilot CLI, ' +
        'or select a different provider. ' +
        `(load error: ${reason})`,
    );
  }
}

// ---------------------------------------------------------------------------
// CopilotSessionAdapter
// ---------------------------------------------------------------------------

/**
 * Adapts the Copilot SDK's `CopilotSession` to the SquadSession interface.
 * Maps sendMessage() → send(), off() via unsubscribe tracking, close() → destroy().
 */
class CopilotSessionAdapter implements SquadSession {
  private static readonly EVENT_MAP: Record<string, string> = {
    'message_delta': 'assistant.message_delta',
    'message': 'assistant.message',
    'usage': 'assistant.usage',
    'reasoning_delta': 'assistant.reasoning_delta',
    'reasoning': 'assistant.reasoning',
    'turn_start': 'assistant.turn_start',
    'turn_end': 'assistant.turn_end',
    'intent': 'assistant.intent',
    'idle': 'session.idle',
    'error': 'session.error',
  };

  private static readonly REVERSE_EVENT_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(CopilotSessionAdapter.EVENT_MAP).map(([k, v]) => [v, k]),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly inner: any;
  private readonly unsubscribers = new Map<SquadSessionEventHandler, Map<string, () => void>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(copilotSession: any) {
    this.inner = copilotSession;
  }

  get sessionId(): string {
    return this.inner.sessionId ?? 'unknown';
  }

  async sendMessage(options: SquadMessageOptions): Promise<void> {
    await this.inner.send(options);
  }

  async sendAndWait(options: SquadMessageOptions, timeout?: number): Promise<unknown> {
    return await this.inner.sendAndWait(options, timeout);
  }

  async abort(): Promise<void> {
    await this.inner.abort();
  }

  async getMessages(): Promise<unknown[]> {
    return await this.inner.getMessages();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static normalizeEvent(sdkEvent: any): SquadSessionEvent {
    const squadType = CopilotSessionAdapter.REVERSE_EVENT_MAP[sdkEvent.type] ?? sdkEvent.type;
    return { type: squadType, ...(sdkEvent.data ?? {}) };
  }

  on(eventType: SquadSessionEventType, handler: SquadSessionEventHandler): void {
    const sdkType = CopilotSessionAdapter.EVENT_MAP[eventType] ?? eventType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrappedHandler = (sdkEvent: any) => {
      handler(CopilotSessionAdapter.normalizeEvent(sdkEvent));
    };
    const unsubscribe = this.inner.on(sdkType, wrappedHandler);
    if (!this.unsubscribers.has(handler)) {
      this.unsubscribers.set(handler, new Map());
    }
    this.unsubscribers.get(handler)!.set(eventType, unsubscribe);
  }

  off(eventType: SquadSessionEventType, handler: SquadSessionEventHandler): void {
    const handlerMap = this.unsubscribers.get(handler);
    if (handlerMap) {
      const unsubscribe = handlerMap.get(eventType);
      if (unsubscribe) {
        unsubscribe();
        handlerMap.delete(eventType);
      }
      if (handlerMap.size === 0) {
        this.unsubscribers.delete(handler);
      }
    }
  }

  async close(): Promise<void> {
    await this.inner.destroy();
    this.unsubscribers.clear();
  }
}

// ---------------------------------------------------------------------------
// CopilotProvider
// ---------------------------------------------------------------------------

export interface CopilotProviderOptions {
  cliPath?: string;
  cliArgs?: string[];
  cwd?: string;
  port?: number;
  useStdio?: boolean;
  cliUrl?: string;
  logLevel?: 'error' | 'warning' | 'info' | 'debug' | 'all' | 'none';
  env?: Record<string, string>;
  githubToken?: string;
  useLoggedInUser?: boolean;
}

export class CopilotProvider implements SquadProvider {
  readonly name = 'copilot' as const;

  /**
   * The real `CopilotClient` instance, constructed lazily on `connect()` once
   * the SDK has been dynamically imported. `undefined` until then.
   */
  private client?: CopilotClientLike;
  private connected = false;
  private options: CopilotProviderOptions;

  constructor(options?: CopilotProviderOptions) {
    // Construction is dependency-free: we only stash options here. The Copilot
    // SDK is not touched until connect(), where it is dynamically imported.
    this.options = options ?? {};
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Ensure the Copilot SDK is loaded and the underlying client is constructed.
   * Loads `@github/copilot-sdk` lazily from the user's environment.
   */
  private async ensureClient(): Promise<CopilotClientLike> {
    if (this.client) {
      return this.client;
    }

    const { CopilotClient } = await loadCopilotSdk();
    this.client = new CopilotClient({
      cliPath: this.options.cliPath,
      cliArgs: this.options.cliArgs ?? [],
      cwd: this.options.cwd ?? process.cwd(),
      port: this.options.port ?? 0,
      useStdio: this.options.useStdio ?? true,
      cliUrl: this.options.cliUrl,
      logLevel: this.options.logLevel ?? 'debug',
      autoStart: false,
      autoRestart: false,
      env: this.options.env ?? (process.env as Record<string, string>),
      gitHubToken: this.options.githubToken,
      useLoggedInUser: this.options.useLoggedInUser ?? (this.options.githubToken ? false : true),
    });
    return this.client;
  }

  async connect(): Promise<void> {
    const client = await this.ensureClient();
    await client.start();
    this.connected = true;
  }

  async disconnect(): Promise<Error[]> {
    if (!this.client) {
      this.connected = false;
      return [];
    }
    const errors = await this.client.stop();
    this.connected = false;
    return errors;
  }

  async forceDisconnect(): Promise<void> {
    if (this.client) {
      await this.client.forceStop();
    }
    this.connected = false;
  }

  async createSession(config: SquadSessionConfig): Promise<SquadSession> {
    const client = await this.ensureClient();
    const session = await client.createSession(
      config as unknown as CopilotClientConfig,
    );
    return new CopilotSessionAdapter(session);
  }

  async resumeSession(sessionId: string, config: SquadSessionConfig): Promise<SquadSession> {
    const client = await this.ensureClient();
    const session = await client.resumeSession(
      sessionId,
      config as unknown as CopilotClientConfig,
    );
    return new CopilotSessionAdapter(session);
  }

  async listSessions(): Promise<SquadSessionMetadata[]> {
    const client = await this.ensureClient();
    const sessions = await client.listSessions();
    return sessions.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any): SquadSessionMetadata => ({
        sessionId: s.sessionId,
        startTime: s.startTime,
        modifiedTime: s.modifiedTime,
        summary: s.summary,
        isRemote: s.isRemote,
        context: s.context as Record<string, unknown> | undefined,
      }),
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const client = await this.ensureClient();
    await client.deleteSession(sessionId);
  }

  async getLastSessionId(): Promise<string | undefined> {
    const client = await this.ensureClient();
    return await client.getLastSessionId();
  }

  async listModels(): Promise<SquadModelInfo[]> {
    const client = await this.ensureClient();
    const models = await client.listModels();
    return models.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any): SquadModelInfo => ({
        id: m.id,
        name: m.name,
        capabilities: m.capabilities,
        policy: m.policy,
        billing: m.billing,
        supportedReasoningEfforts: m.supportedReasoningEfforts,
        defaultReasoningEffort: m.defaultReasoningEffort,
      }),
    );
  }

  async getAuthStatus(): Promise<SquadGetAuthStatusResponse> {
    const client = await this.ensureClient();
    const raw = await client.getAuthStatus();
    return {
      isAuthenticated: raw.isAuthenticated,
      authType: raw.authType,
      host: raw.host,
      login: raw.login,
      statusMessage: raw.statusMessage,
    };
  }

  async getStatus(): Promise<SquadGetStatusResponse> {
    const client = await this.ensureClient();
    const raw = await client.getStatus();
    return { version: raw.version, protocolVersion: raw.protocolVersion };
  }

  async ping(message?: string): Promise<{ message: string; timestamp: number; protocolVersion?: number }> {
    const client = await this.ensureClient();
    return await client.ping(message);
  }

  on(eventTypeOrHandler: SquadClientEventType | SquadClientEventHandler, handler?: (event: SquadClientEvent) => void): () => void {
    // Lifecycle subscriptions require a constructed client. If the SDK has not
    // been loaded yet (connect() not called), return a no-op unsubscribe.
    if (!this.client) {
      return () => {};
    }
    if (typeof eventTypeOrHandler === 'string' && handler) {
      return this.client.on(eventTypeOrHandler, handler);
    }
    return this.client.on(eventTypeOrHandler as SquadClientEventHandler);
  }
}
