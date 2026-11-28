import { randomUUID } from 'node:crypto'
import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'
import {
  EGithubPollStatus,
  GithubConfig,
  GithubDeviceClient,
  GithubService,
  REQUESTED_SCOPES,
} from '@dltech/atlas-github'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import {
  BrowserReturnService,
  type BrowserReturnCallbackAnswer,
  type BrowserReturnClaim,
} from '../../../agent'

export const GITHUB_CALLBACK_PATH = '/v1/github/oauth/callback'
const WEB_PATH = '/settings/integrations'

type GithubCallback = {
  state: string
  code?: string | undefined
  error?: string | undefined
  errorDescription?: string | undefined
  cookieHeader: string | undefined
}

@Injectable()
export class GithubRedirectService {
  constructor(
    private readonly github: GithubService,
    private readonly client: GithubDeviceClient,
    private readonly config: GithubConfig,
    private readonly returns: BrowserReturnService,
  ) {}

  async begin(args: { userId: string }): Promise<{ url: string }> {
    const { clientId } = this.credentials()
    const state = randomUUID()
    const provider = new URL('https://github.com/login/oauth/authorize')
    provider.searchParams.set('client_id', clientId)
    provider.searchParams.set('redirect_uri', this.redirectUri())
    provider.searchParams.set('scope', REQUESTED_SCOPES)
    provider.searchParams.set('state', state)
    const begun = await this.returns.begin({
      flow: 'github',
      state,
      userId: args.userId,
      providerUrl: provider.toString(),
      callbackPath: GITHUB_CALLBACK_PATH,
      webPath: WEB_PATH,
    })
    return { url: begun.startUrl }
  }

  async callback(args: GithubCallback): Promise<BrowserReturnCallbackAnswer> {
    const claim = await this.returns.claim({ state: args.state, flow: 'github' })
    let outcome: ReturnOutcome
    try {
      outcome = await this.connect({ callback: args, claim })
    } catch (error) {
      outcome = {
        result: EReturnResult.Failed,
        reason: error instanceof Error ? error.message : 'GitHub connection failed',
      }
    }
    return this.returns.answerClaimed({
      claim,
      request: {
        state: args.state,
        cookieHeader: args.cookieHeader,
        outcome,
        fallbackWebPath: WEB_PATH,
      },
    })
  }

  private async connect(args: {
    callback: GithubCallback
    claim: BrowserReturnClaim | null
  }): Promise<ReturnOutcome> {
    const userId = args.claim?.userId
    if (userId === undefined)
      return { result: EReturnResult.Failed, reason: 'That GitHub sign-in expired. Try again.' }
    const callback = args.callback
    if (callback.error !== undefined)
      return { result: EReturnResult.Failed, reason: callback.errorDescription ?? callback.error }
    if (callback.code === undefined || callback.code.length === 0)
      return { result: EReturnResult.Failed, reason: 'GitHub returned no authorization code' }
    const token = await this.client.exchangeRedirectToken({
      ...this.credentials(),
      code: callback.code,
      redirectUri: this.redirectUri(),
    })
    const result = await this.github.connectWithToken({ userId, ...token })
    if (result.status === EGithubPollStatus.Connected) return { result: EReturnResult.Connected }
    return {
      result: EReturnResult.Failed,
      reason:
        result.status === EGithubPollStatus.MissingScopes
          ? `GitHub didn't grant ${result.missing.join(', ')}. Approve every permission to continue.`
          : 'GitHub connection failed',
    }
  }

  private redirectUri(): string {
    return new URL(GITHUB_CALLBACK_PATH, this.config.values.publicApiUrl).toString()
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const { clientId, clientSecret } = this.config.values
    if (!clientId || !clientSecret)
      throw new ServiceUnavailableException('github connect is not configured')
    return { clientId, clientSecret }
  }
}
