import { Injectable, Logger } from '@nestjs/common'
import { GithubService } from '../github/github.service'

export type SandboxGitCredentialSource = {
  findToken(args: {
    userId: string
    threadId: string
    remoteUrl: string
  }): Promise<string | null | undefined>
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Which git credential a sandbox's workspace gets is a property of who the sandbox serves: an
 * operator's lifted session uses the operator's device-auth token, a factory station uses the
 * factory GitHub App. The factory module cannot be imported here without a module cycle, so it
 * registers its source at boot and this broker tries it before the default.
 */
@Injectable()
export class SandboxGitCredentials {
  private readonly logger = new Logger(SandboxGitCredentials.name)
  private source: SandboxGitCredentialSource | null = null

  constructor(private readonly github: GithubService) {}

  register(source: SandboxGitCredentialSource): void {
    this.source = source
  }

  async findToken(args: {
    userId: string
    threadId: string
    remoteUrl: string
  }): Promise<string | null> {
    if (this.source !== null) {
      try {
        const token = await this.source.findToken(args)
        if (token !== undefined && token !== null) return token
      } catch (failure) {
        this.logger.warn(`the registered git credential source failed: ${messageOf(failure)}`)
      }
    }
    return (await this.github.findToken({ userId: args.userId })) ?? null
  }
}
