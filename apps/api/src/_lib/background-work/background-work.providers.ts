import type { ClassProvider } from '@nestjs/common'
import { waitUntil } from '@vercel/functions'

import { BackgroundWork } from '../../_core/ports/background-work'

export function runsOnVercel(): boolean {
  return process.env.VERCEL === '1'
}

// https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil
export class VercelBackgroundWork extends BackgroundWork {
  keepAlive(work: Promise<unknown>): void {
    waitUntil(work)
  }
}

export class ProcessBackgroundWork extends BackgroundWork {
  keepAlive(): void {}
}

export function backgroundWorkProvider(): ClassProvider<BackgroundWork> {
  return {
    provide: BackgroundWork,
    useClass: runsOnVercel() ? VercelBackgroundWork : ProcessBackgroundWork,
  }
}
