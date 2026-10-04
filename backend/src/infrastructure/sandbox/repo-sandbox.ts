import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type {
  ExtractionSummary,
  HostOperation,
  HostResponse,
} from '../../repo-host/protocol.js';

const CHUNK_BYTES = 256 * 1024;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export type SandboxErrorCode =
  | 'SANDBOX_NOT_CONFIGURED'
  | 'SANDBOX_START_FAILED'
  | 'SANDBOX_CRASHED'
  | 'SANDBOX_TIMEOUT';

/** Error whose message is safe to store; it never contains repository content. */
export class SandboxError extends Error {
  /** Ends the whole analysis instead of being shown to the model. */
  readonly fatal = true;

  constructor(
    readonly code: SandboxErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** A `repo-host` operation failed; `code` comes from the host protocol. */
export class HostCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SandboxCommand {
  command: string;
  args: string[];
  /** Only what the host needs; never the control plane's secrets. */
  env: NodeJS.ProcessEnv;
}

/** One running `repo-host` for one analysis job (ADR-0013). */
export class RepoSandboxSession {
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private exited: SandboxError | null = null;
  private readonly wallTimer: NodeJS.Timeout;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    wallTimeMs: number,
    private readonly onClose: () => void = () => undefined,
  ) {
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
      'line',
      (line) => this.onLine(line),
    );
    // The host logs nothing sensitive, but stderr is still never stored.
    child.stderr.resume();
    child.on('exit', () =>
      this.fail(new SandboxError('SANDBOX_CRASHED', 'Sandbox exited')),
    );
    child.on('error', () =>
      this.fail(new SandboxError('SANDBOX_START_FAILED', 'Sandbox failed')),
    );
    this.wallTimer = setTimeout(() => {
      this.fail(new SandboxError('SANDBOX_TIMEOUT', 'Sandbox time limit'));
      child.kill('SIGKILL');
    }, wallTimeMs);
    this.wallTimer.unref();
  }

  call<T>(
    op: HostOperation,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_CALL_TIMEOUT_MS,
  ): Promise<T> {
    if (this.exited) return Promise.reject(this.exited);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SandboxError('SANDBOX_TIMEOUT', `Sandbox ${op} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ id, op, params })}\n`);
    });
  }

  /** Streams the repository archive into the sandbox. */
  async loadArchive(archive: Readable): Promise<ExtractionSummary> {
    let buffered: Buffer[] = [];
    let size = 0;
    const flush = async () => {
      if (size === 0) return;
      const data = Buffer.concat(buffered).toString('base64');
      buffered = [];
      size = 0;
      await this.call('archive.chunk', { data });
    };
    for await (const chunk of archive as AsyncIterable<Buffer>) {
      buffered.push(chunk);
      size += chunk.length;
      if (size >= CHUNK_BYTES) await flush();
    }
    await flush();
    return this.call<ExtractionSummary>('archive.end', {}, 10 * 60_000);
  }

  async close(): Promise<void> {
    clearTimeout(this.wallTimer);
    this.child.stdin.end();
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) resolve();
      else this.child.once('exit', () => resolve());
    });
    const forced = setTimeout(() => this.child.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(forced);
    this.onClose();
  }

  private onLine(line: string): void {
    let response: HostResponse;
    try {
      response = JSON.parse(line) as HostResponse;
    } catch {
      return;
    }
    const waiter = this.pending.get(response.id);
    if (!waiter) return;
    this.pending.delete(response.id);
    if (response.ok) waiter.resolve(response.result);
    else
      waiter.reject(
        new HostCallError(response.error.code, response.error.message),
      );
  }

  private fail(error: SandboxError): void {
    this.exited ??= error;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}

/** Starts sandboxes; the implementation is chosen by `ANALYSIS_SANDBOX`. */
export abstract class RepoSandbox {
  abstract readonly isConfigured: boolean;
  abstract start(): Promise<RepoSandboxSession>;

  protected launch(
    command: SandboxCommand,
    wallTimeMs: number,
    onClose?: () => void,
  ): RepoSandboxSession {
    const child = spawn(command.command, command.args, {
      env: command.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return new RepoSandboxSession(child, wallTimeMs, onClose);
  }
}

export class UnconfiguredRepoSandbox extends RepoSandbox {
  readonly isConfigured = false;

  start(): Promise<RepoSandboxSession> {
    return Promise.reject(
      new SandboxError(
        'SANDBOX_NOT_CONFIGURED',
        'No analysis sandbox is configured',
      ),
    );
  }
}

/**
 * Production sandbox: a disposable container with no network, a read-only
 * root filesystem, an unprivileged user, no capabilities and resource limits.
 * The worker needs container-runtime access; the public API must not.
 */
export class DockerRepoSandbox extends RepoSandbox {
  readonly isConfigured = true;

  constructor(
    private readonly image: string,
    private readonly runtime: 'runsc' | 'runc',
    private readonly memoryMb: number,
    private readonly wallTimeMs: number,
  ) {
    super();
  }

  start(): Promise<RepoSandboxSession> {
    const name = `tessera-repo-host-${randomUUID()}`;
    const args = [
      'run',
      '--rm',
      '-i',
      '--name',
      name,
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--memory',
      `${this.memoryMb}m`,
      '--memory-swap',
      `${this.memoryMb}m`,
      '--cpus',
      '2',
      '--pids-limit',
      '256',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '65534:65534',
      ...(this.runtime === 'runsc' ? ['--runtime', 'runsc'] : []),
      this.image,
    ];
    const session = this.launch(
      { command: 'docker', args, env: { PATH: process.env.PATH } },
      this.wallTimeMs,
      () => {
        // `--rm` removes it; this only covers a killed client.
        spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }).on(
          'error',
          () => undefined,
        );
      },
    );
    return Promise.resolve(session);
  }
}

/**
 * Development only: `repo-host` as a plain child process. It gets an empty
 * environment, but no isolation; refused in production (ADR-0013).
 */
export class LocalProcessRepoSandbox extends RepoSandbox {
  readonly isConfigured = true;

  constructor(private readonly wallTimeMs: number) {
    super();
  }

  start(): Promise<RepoSandboxSession> {
    const entry = new URL('../../repo-host/main.js', import.meta.url);
    return Promise.resolve(
      this.launch(
        {
          command: process.execPath,
          args: [entry.pathname],
          env: { PATH: process.env.PATH, NODE_ENV: 'production' },
        },
        this.wallTimeMs,
      ),
    );
  }
}
