import { createHash } from 'node:crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import type { ControlSessionRow } from '@dltech/atlas-control'
import type {
  AgentHostConfigOutput,
  AgentHostGithubTokenOutput,
  AgentHostModelAccessTokenOutput,
} from '@dltech/atlas-protocol'
import { GithubService } from '../github/github.service'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { AccountsService } from '../../platform/accounts/accounts.service'
import { OauthConnectionsService } from '../../platform/oauth-connections/oauth-connections.service'
import { modelConfigOf } from './agent-host-model-config'

const CONFIG_TTL_MS = 300_000

@Injectable()
export class AgentHostService {
  constructor(
    private readonly plane: ControlPlane,
    private readonly scopedConfig: ScopedConfigService,
    private readonly oauthConnections: OauthConnectionsService,
    private readonly github: GithubService,
    private readonly accounts: AccountsService,
  ) {}

  async config(args: { sessionId: string }): Promise<AgentHostConfigOutput> {
    const session = await this.requireSession(args)
    const config = await this.scopedConfig.resolveForPod({
      userId: session.userId,
      projectId: session.projectId,
    })
    const vercel = await this.vercelOf({ userId: session.userId })
    const lease = await this.accounts.lease({ userId: session.userId })
    const model = modelConfigOf({ lease, settings: config.settings })
    const issuedAt = Date.now()
    return {
      userId: session.userId,
      projectId: session.projectId,
      model,
      vercel,
      config: config as unknown as AgentHostConfigOutput['config'],
      revision: createHash('sha256')
        .update(JSON.stringify(config))
        .update(JSON.stringify(model))
        .digest('hex'),
      expiresAt: new Date(issuedAt + CONFIG_TTL_MS).toISOString(),
    }
  }

  async modelAccessToken(args: {
    sessionId: string
    connectionId: string
    rejectedAccessToken?: string | undefined
  }): Promise<AgentHostModelAccessTokenOutput> {
    const session = await this.requireSession(args)
    const token = await this.oauthConnections.issueAccessToken({
      userId: session.userId,
      connectionId: args.connectionId,
      ...(args.rejectedAccessToken === undefined
        ? {}
        : { rejectedAccessToken: args.rejectedAccessToken }),
    })
    return {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      refreshAfter: token.refreshAfter,
      generation: token.generation,
      authorizationId: token.authorizationId,
      ...(token.providerAccountId === undefined
        ? {}
        : { providerAccountId: token.providerAccountId }),
    }
  }

  async githubToken(args: { sessionId: string }): Promise<AgentHostGithubTokenOutput> {
    const session = await this.requireSession(args)
    const token = await this.github.findToken({ userId: session.userId })
    return { token: token ?? null }
  }

  private async requireSession(args: { sessionId: string }): Promise<ControlSessionRow> {
    const session = await this.plane.readSession({ sessionId: args.sessionId })
    if (session === undefined) throw new NotFoundException('session not found')
    return session
  }

  private async vercelOf(args: { userId: string }): Promise<AgentHostConfigOutput['vercel']> {
    try {
      const credentials = await this.scopedConfig.vercelCredentials({
        thread: { userId: args.userId },
      })
      return {
        configured: true,
        token: credentials.token,
        teamId: credentials.teamId,
        projectId: credentials.projectId,
      }
    } catch (error) {
      if (error instanceof VercelNotConfiguredError) {
        return { configured: false, gap: error.gap }
      }
      throw error
    }
  }
}
