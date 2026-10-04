import { Worker } from 'node:worker_threads';
import type { FileStore } from './files.js';
import type { RegexJob, RegexJobResult } from './regex-worker.js';

export class RegexTimeoutError extends Error {}

/** Untrusted regex execution with a hard time limit per job. */
export class RegexEngine {
  private worker: Worker | null = null;
  private nextJobId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: FileStore) {}

  /** Throws SyntaxError for invalid patterns before any work is queued. */
  static compile(pattern: string, flags: string): RegExp {
    return new RegExp(pattern, flags);
  }

  run(
    job: Omit<RegexJob, 'jobId'>,
    timeoutMs: number,
  ): Promise<RegexJobResult> {
    const next = this.queue.then(() => this.execute(job, timeoutMs));
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    await this.worker?.terminate();
    this.worker = null;
  }

  private execute(
    job: Omit<RegexJob, 'jobId'>,
    timeoutMs: number,
  ): Promise<RegexJobResult> {
    const worker = this.ensureWorker();
    const jobId = this.nextJobId++;
    return new Promise<RegexJobResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        // A runaway pattern blocks the worker; replace it.
        void worker.terminate();
        this.worker = null;
        reject(new RegexTimeoutError('Regular expression timed out'));
      }, timeoutMs);
      const onMessage = (result: RegexJobResult) => {
        if (result.jobId !== jobId) return;
        cleanup();
        resolve(result);
      };
      const onError = (error: Error) => {
        cleanup();
        this.worker = null;
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
      };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.postMessage({ ...job, jobId } satisfies RegexJob);
    });
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      const files: [string, string[]][] = [...this.store.files.values()].map(
        (file) => [file.path, file.lines],
      );
      this.worker = new Worker(new URL('./regex-worker.js', import.meta.url), {
        workerData: { files },
      });
      this.worker.unref();
    }
    return this.worker;
  }
}
