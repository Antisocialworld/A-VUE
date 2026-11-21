import { waitUntil } from '@vercel/functions';

function logBackgroundError(label: string): void {
  process.stderr.write(`[Background] outcome=error label=${label}\n`);
}

function guardedTask(label: string, task: () => Promise<void>): Promise<void> {
  try {
    return task().catch(() => {
      logBackgroundError(label);
    });
  } catch {
    logBackgroundError(label);
    return Promise.resolve();
  }
}

export function runInBackground(label: string, task: () => Promise<void>): void {
  if (process.env.VERCEL !== undefined) {
    try {
      waitUntil(guardedTask(label, task));
    } catch {
      logBackgroundError(label);
    }
    return;
  }

  setImmediate(() => {
    void guardedTask(label, task);
  });
}
