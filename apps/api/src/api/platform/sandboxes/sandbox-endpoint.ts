import { Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { ownedSandbox } from './ownership'
import { toSandboxDto } from './rows'
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
    const row = await db.cloudSandbox.findFirst({
      where: { threadId: args.threadId, userId: args.userId },
      select: { name: true, sealedToken: true, serveUrl: true, state: true },
    })
    if (row === null || row.sealedToken === null) return null
    if (row.serveUrl !== null) {
      if (row.state !== ESandboxState.Running) return null
      const token = this.unsealToken({ name: row.name, sealedToken: row.sealedToken })
      return token === null ? null : { token, url: row.serveUrl }
    }
    const token = this.unsealToken({ name: row.name, sealedToken: row.sealedToken })
    if (token === null) return null
    let observed: SandboxObservation
    try {
      observed = await this.vercel.inspect({ name: row.name })
    } catch {
      return null
    }
    if (observed.state !== ESandboxState.Running || observed.url === undefined) return null
    return { token, url: observed.url }
  }

  async status(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    const row = await ownedSandbox(args)
    if (row.serveUrl !== null) {
      return {
        ...toSandboxDto(row),
        ...(row.state === ESandboxState.Running ? { url: row.serveUrl } : {}),
      }
    }
    try {
      const observed = await this.vercel.inspect({ name: row.name })
      return {
        ...toSandboxDto(row),
        state: observed.state,
        ...(observed.url === undefined ? {} : { url: observed.url }),
      }
    } catch (failure) {
      if (failure instanceof SandboxMissingError) return toSandboxDto(row)
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
