import { Inject, Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import {
  createStandaloneTitler,
  type SaidImage,
  type StandaloneTitler,
} from '@dltech/atlas-harness/titling'
import { AccountsService } from '../../platform/accounts/accounts.service'
import { OauthConnectionsService } from '../../platform/oauth-connections/oauth-connections.service'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { accountsOf, ApiCredentialPort } from './api-credential-port'

export const TITLER_FACTORY = Symbol('TITLER_FACTORY')
export type TitlerFactory = typeof createStandaloneTitler

export const TITLING_TIMEOUT_MS = 20_000

export type TitleFirstMessage = {
  userId: string
  threadId: string
  projectId: string | null
  text: string
  images?: readonly SaidImage[] | undefined
}

@Injectable()
export class ThreadTitlingService {
  private readonly log = new Logger(ThreadTitlingService.name)

  constructor(
    private readonly config: ScopedConfigService,
    private readonly accounts: AccountsService,
    private readonly oauth: OauthConnectionsService,
    private readonly signals: ThreadSignalsService,
    @Inject(TITLER_FACTORY) private readonly titlerFactory: TitlerFactory,
  ) {}

  async titleFirstMessage(args: TitleFirstMessage): Promise<void> {
    try {
      const title = await this.generate(args)
      if (title === null) return
      const changed = await this.writeIfUntitled({ threadId: args.threadId, title })
      if (!changed) return
      this.signals.threadChanged({ threadId: args.threadId })
    } catch (failure) {
      this.log.warn(`titling ${args.threadId} failed: ${String(failure)}`)
    }
  }

  private async generate(args: TitleFirstMessage): Promise<string | null> {
    const [config, lease] = await Promise.all([
      this.config.resolveForPod({ userId: args.userId, projectId: args.projectId }),
      this.accounts.lease({ userId: args.userId }),
    ])
    const titler: StandaloneTitler = this.titlerFactory({
      settings: config.settings,
      accounts: accountsOf(lease),
      credentials: new ApiCredentialPort({ userId: args.userId, lease, oauth: this.oauth }),
    })
    return titler({
      text: args.text,
      images: args.images,
      signal: AbortSignal.timeout(TITLING_TIMEOUT_MS),
    })
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
