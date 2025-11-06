// worker/src/admin-queue.ts
// Lightweight async execution queue with throttling and retry/backoff for Shopify Admin API.
// Goal: cap to ~2 req/sec to respect Admin API limits and prevent Worker blocking.

export type AdminTaskFn<T> = () => Promise<T>;

export type ThrottleOptions = {
  // Maximum number of requests allowed per second
  requestsPerSecond?: number; // default: 2
  // Maximum retries for retryable errors (e.g., 429, 5xx)
  maxRetries?: number; // default: 3
  // Base delay for exponential backoff in ms
  baseBackoffMs?: number; // default: 250
  // Jitter range in ms to avoid thundering herd
  jitterMs?: number; // default: 50
};

export class AdminExecutionQueue {
  private queue: Array<{
    fn: AdminTaskFn<any>;
    resolve: (v: any) => void;
    reject: (e: any) => void;
    attempt: number;
  }> = [];

  private readonly rps: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly jitterMs: number;

  // Sliding window timestamps for launches within the last 1000 ms
  private launches: number[] = [];
  private processing = false;

  constructor(opts?: ThrottleOptions) {
    this.rps = Math.max(1, Math.floor(opts?.requestsPerSecond ?? 2));
    this.maxRetries = Math.max(0, Math.floor(opts?.maxRetries ?? 3));
    this.baseBackoffMs = Math.max(1, Math.floor(opts?.baseBackoffMs ?? 250));
    this.jitterMs = Math.max(0, Math.floor(opts?.jitterMs ?? 50));
  }

  /**
   * Enqueue an Admin API call to be executed with throttling and retry/backoff.
   */
  enqueueAdminCall<T>(fn: AdminTaskFn<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, attempt: 0 });
      void this.ensureProcessing();
    });
  }

  private async ensureProcessing() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        // Clear launches older than 1s
        this.launches = this.launches.filter((t) => now - t < 1000);
        if (this.launches.length >= this.rps) {
          // Need to wait until oldest launch exits 1s window
          const oldest = this.launches[0];
          const waitMs = Math.max(0, 1000 - (now - oldest));
          await sleep(waitMs);
          continue;
        }

        const task = this.queue.shift()!; // defined due to while guard
        this.launches.push(Date.now());

        try {
          const result = await task.fn();
          task.resolve(result);
        } catch (err: any) {
          // Determine if retryable
          const status = (err && typeof err === 'object' && 'status' in err) ? Number((err as any).status) : undefined;
          const retryable = status === 429 || (status !== undefined && status >= 500);

          if (retryable && task.attempt < this.maxRetries) {
            task.attempt += 1;
            const backoff = this.computeBackoff(task.attempt);
            // Re-queue after backoff
            await sleep(backoff);
            this.queue.unshift(task); // give retried task priority to maintain order fairness
          } else {
            task.reject(err);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private computeBackoff(attempt: number): number {
    const base = this.baseBackoffMs * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0;
    return base + jitter;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simple module-level singleton (optional convenience)
let __queue: AdminExecutionQueue | null = null;
export function getAdminExecutionQueue(): AdminExecutionQueue {
  if (!__queue) __queue = new AdminExecutionQueue();
  return __queue;
}

// Export sleep for tests
export const __test = { sleep };
