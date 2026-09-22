import { Injectable, type OnModuleInit } from '@nestjs/common'
import { db } from '../../../db'
import {
  SandboxGitCredentials,
  type SandboxGitCredentialSource,
} from '../../platform/sandboxes/git-credentials'
import { GithubAppService } from '../reply/github-app.service'

/**
 * Factory station sandboxes clone and fetch as the factory GitHub App, never as a user: their
 * threads belong to the factory system user, which has no device-auth token. Registered into the
 * sandbox git credential broker at boot; non-factory threads fall through to the default.
 */
@Injectable()
export class FactoryGitCredentialSource implements SandboxGitCredentialSource, OnModuleInit {
  constructor(
    private readonly broker: SandboxGitCredentials,
    private readonly githubApp: GithubAppService,
  ) {}

  onModuleInit(): void {
    this.broker.register(this)
  }

  async findToken(args: {
    userId: string
    threadId: string
    remoteUrl: string
  }): Promise<string | undefined> {
    const run = await db.factoryStationRun.findFirst({
      where: { threadId: args.threadId },
      select: { workItemId: true },
    })
    if (run === null) return undefined
    const item = await db.factoryWorkItem.findUnique({
      where: { id: run.workItemId },
      select: { repo: true },
    })
    const [owner, repo] = item?.repo.split('/') ?? []
    if (owner === undefined || repo === undefined) return undefined
    return this.githubApp.installationToken({ owner, repo })
  }
}
