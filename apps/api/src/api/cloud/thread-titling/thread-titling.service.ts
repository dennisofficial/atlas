import { Inject, Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { SaidImage } from '@dltech/atlas-core'
import type { SessionNamer } from '../../../agent'
import { SessionTitler } from '../../../_core/ports/session-titler'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'

export const SESSION_NAMER = Symbol('SESSION_NAMER')

export const TITLING_TIMEOUT_MS = 20_000

export type TitleFirstMessage = {
  userId: string
  threadId: string
  projectId: string | null
  text: string
  images?: readonly SaidImage[] | undefined
}

type TitleSource = {
  userId: string
  projectId: string | null
  text: string
  images?: readonly SaidImage[] | undefined
  modelRef?: string | undefined
  onFault?: ((fault: unknown) => void) | undefined
}

@Injectable()
export class ThreadTitlingService extends SessionTitler {
  private readonly log = new Logger(ThreadTitlingService.name)

  constructor(
    private readonly signals: ThreadSignalsService,
    @Inject(SESSION_NAMER) private readonly namer: SessionNamer,
  ) {
    super()
  }

  nameOf(args: TitleSource): Promise<string | null> {
    return this.generate(args)
  }

  async titleFirstMessage(args: TitleFirstMessage): Promise<void> {
    try {
      const title = await this.generate({
        ...args,
        onFault: (fault) => this.log.warn(`titling ${args.threadId} failed: ${String(fault)}`),
      })
      if (title === null) return
      const changed = await this.writeIfUntitled({ threadId: args.threadId, title })
      if (!changed) return
      this.signals.threadChanged({ threadId: args.threadId })
    } catch (failure) {
      this.log.warn(`titling ${args.threadId} failed: ${String(failure)}`)
    }
  }

  private generate(args: TitleSource): Promise<string | null> {
    return this.namer({ ...args, signal: AbortSignal.timeout(TITLING_TIMEOUT_MS) })
  }

  private async writeIfUntitled(args: { threadId: string; title: string }): Promise<boolean> {
    const statement = db.raw.sql`UPDATE "Session" SET "title" = ${args.title}
      WHERE "id" = (SELECT "sessionId" FROM "Thread" WHERE "id" = ${args.threadId})
        AND "title" IS NULL`
      .affectedCount()
      .build()
    const { affectedRows } = await db.execute(statement)
    return affectedRows === 1
  }
}
