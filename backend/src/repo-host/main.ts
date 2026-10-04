import { createInterface } from 'node:readline';
import { HostError, RepoHost } from './host.js';
import type { HostRequest, HostResponse } from './protocol.js';

/**
 * `repo-host` entry point: runs inside the analysis sandbox (no network, no
 * credentials) and serves the protocol in `protocol.ts` over stdio. Requests
 * are processed one at a time so archive chunks stay ordered.
 */
const host = new RepoHost();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue: Promise<void> = Promise.resolve();

function respond(response: HostResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

input.on('line', (line) => {
  queue = queue.then(async () => {
    let request: HostRequest;
    try {
      request = JSON.parse(line) as HostRequest;
      if (typeof request.id !== 'number' || typeof request.op !== 'string') {
        throw new Error('invalid');
      }
    } catch {
      respond({
        id: -1,
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'Malformed request' },
      });
      return;
    }
    try {
      const result = await host.handle(request.op, request.params ?? {});
      respond({ id: request.id, ok: true, result });
    } catch (error) {
      respond({
        id: request.id,
        ok: false,
        error:
          error instanceof HostError
            ? { code: error.code, message: error.message }
            : { code: 'INTERNAL', message: 'Operation failed' },
      });
    }
  });
});

input.on('close', () => {
  void queue.then(() => host.close()).then(() => process.exit(0));
});
