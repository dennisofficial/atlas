import { Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { podSessionOf } from '../sessions/session-of-thread'
import { ownedSandbox } from './ownership'
import { toSandboxDto } from './rows'
import { SANDBOX_LIFECYCLE_COLUMNS, sandboxStateOf } from './sandbox-lifecycle'
import { ESandboxState, type SandboxStatusDto } from './sandboxes.types'
import {
  SandboxMissingError,
  VercelSandboxClient,
  type SandboxObservation,
} from './vercel-sandbox.client'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class SandboxEndpointService {
  private readonly logger = new Logger(SandboxEndpointService.name)

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly cipher: SecretCipherService,
  ) {}

  async runningEndpoint(args: {
    userId: string
    threadId: string
  }): Promise<{ token: string; url: string } | null> {
    const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
    const row = await db.orm.public.CloudSandbox.where({
      sessionId,
      userId: args.userId,
    })
      .select(...SANDBOX_LIFECYCLE_COLUMNS, 'name', 'sealedToken', 'serveUrl')
      .first()
    if (row === null || row.sealedToken === null) return null
    if (row.serveUrl !== null) {
      if (sandboxStateOf(row) !== ESandboxState.Running) return null
      const token = this.unsealToken({ name: row.name, sealedToken: row.sealedToken })
      return token === null ? null : { token, url: row.serveUrl }
    }
    const token = this.unsealToken({ name: row.name, sealedToken: row.sealedToken })
    if (token === null) return null
    let observed: SandboxObservation
    try {
      observed = await this.vercel.inspect({ threadId: args.threadId, name: row.name })
    } catch {
      return null
    }
    if (observed.state !== ESandboxState.Running || observed.url === undefined) return null
    return { token, url: observed.url }
  }

  async observedRunning(args: { threadId: string }): Promise<boolean> {
    const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
    const row = await db.orm.public.CloudSandbox.where({ sessionId }).select('name').first()
    if (row === null) return true
    const observed = await this.vercel.inspect({ threadId: args.threadId, name: row.name })
    return observed.state === ESandboxState.Running
  }

  async status(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    const row = await ownedSandbox(args)
    if (row.serveUrl !== null) {
      return {
        ...toSandboxDto({ row, threadId: args.threadId }),
        ...(sandboxStateOf(row) === ESandboxState.Running ? { url: row.serveUrl } : {}),
      }
    }
    try {
      const observed = await this.vercel.inspect({ threadId: args.threadId, name: row.name })
      return {
        ...toSandboxDto({ row, threadId: args.threadId }),
        state: observed.state,
        ...(observed.url === undefined ? {} : { url: observed.url }),
      }
    } catch (failure) {
      if (failure instanceof SandboxMissingError)
        return toSandboxDto({ row, threadId: args.threadId })
      throw failure
    }
  }

  private unsealToken(args: { name: string; sealedToken: string }): string | null {
    try {
      return this.cipher.decrypt(args.sealedToken)
    } catch (failure) {
      this.logger.warn(
        `the sealed token on sandbox ${args.name} does not decrypt; the next attach re-seals it: ${messageOf(failure)}`,
      )
      return null
    }
  }
}
