import type { ClassProvider, OnApplicationShutdown } from '@nestjs/common'
import { waitUntil } from '@vercel/functions'

import { BackgroundWork } from '../../_core/ports/background-work'

export const BACKGROUND_WORK_SHUTDOWN_CAP_MS = 5_000

export function runsOnVercel(): boolean {
  return process.env.VERCEL === '1'
}

// https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil
export class VercelBackgroundWork extends BackgroundWork {
  keepAlive(work: Promise<unknown>): void {
    waitUntil(work)
  }
}

const after = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref()
  })

export class ProcessBackgroundWork extends BackgroundWork implements OnApplicationShutdown {
  private readonly running = new Set<Promise<unknown>>()

  keepAlive(work: Promise<unknown>): void {
    const tracked = work.catch(() => undefined)
    this.running.add(tracked)
    void tracked.finally(() => this.running.delete(tracked))
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.running.size === 0) return
    await Promise.race([
      Promise.allSettled([...this.running]),
      after(BACKGROUND_WORK_SHUTDOWN_CAP_MS),
    ])
  }
}

export function backgroundWorkProvider(): ClassProvider<BackgroundWork> {
  return {
    provide: BackgroundWork,
    useClass: runsOnVercel() ? VercelBackgroundWork : ProcessBackgroundWork,
  }
}
