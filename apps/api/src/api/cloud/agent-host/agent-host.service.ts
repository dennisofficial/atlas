import { Injectable, NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import type { ControlSessionRow } from '@dltech/atlas-control'
import type {
  AgentHostGithubTokenOutput,
  AgentHostModelAccessTokenOutput,
} from '@dltech/atlas-protocol'
import { GithubService } from '../github/github.service'
import { OauthConnectionsService } from '../../platform/oauth-connections/oauth-connections.service'

@Injectable()
export class AgentHostService {
  constructor(
    private readonly plane: ControlPlane,
    private readonly oauthConnections: OauthConnectionsService,
    private readonly github: GithubService,
  ) {}

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
}
