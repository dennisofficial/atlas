import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import {
  anthropicExchangePasted,
  anthropicManualAuthorizeUrl,
  anthropicPkce,
  DeviceCodeDisabledError,
  EDevicePoll,
  OauthHttpError,
  OauthResponseError,
  openaiPollDevice,
  openaiStartDevice,
  type OauthLogin,
} from '@dltech/atlas-harness/provider-oauth'
import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  EOauthProvider,
  EProviderSignInFlow,
  EProviderSignInPoll,
  type AccountDto,
  type AccountSecretDto,
  type ProviderSignInBegin,
  type ProviderSignInPoll,
  type SecretInput,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { AccountsService } from '../accounts/accounts.service'
import { OauthConnectionsService } from '../oauth-connections/oauth-connections.service'
import { ProviderHttp } from './provider-http'
import { openAttempt, sealAttempt, type SignInAttempt } from './sign-in-attempt'

export const PASTE_ATTEMPT_TTL_MS = 10 * 60 * 1000

const AUTH_PROVIDER_OF: Record<EOauthProvider, EAuthProvider> = {
  [EOauthProvider.Anthropic]: EAuthProvider.Anthropic,
  [EOauthProvider.OpenAI]: EAuthProvider.OpenAI,
}

const PROVIDER_LABEL: Record<EOauthProvider, string> = {
  [EOauthProvider.Anthropic]: 'Claude',
  [EOauthProvider.OpenAI]: 'ChatGPT',
}

const expired = (): BadRequestException =>
  new BadRequestException('that sign-in expired — start the sign-in again')

const labelFor = (args: { provider: EOauthProvider; login: OauthLogin }): string => {
  if (args.login.email !== undefined) return args.login.email
  const name = PROVIDER_LABEL[args.provider]
  return args.login.subscription === undefined ? name : `${name} (${args.login.subscription})`
}

async function providerCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof DeviceCodeDisabledError) throw new BadRequestException(error.message)
    if (error instanceof OauthHttpError && [400, 401, 403].includes(error.status))
      throw new BadRequestException(
        'the provider refused that code — it may be mistyped or already used. Start the sign-in again.',
      )
    if (error instanceof OauthResponseError) throw new BadRequestException(error.message)
    if (error instanceof OauthHttpError) throw new BadGatewayException(error.message)
    throw error
  }
}

@Injectable()
export class ProviderSignInService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly http: ProviderHttp,
    private readonly env: EnvService,
    private readonly accounts: AccountsService,
    private readonly connections: OauthConnectionsService,
  ) {}

  async begin(args: { userId: string; provider: EOauthProvider }): Promise<ProviderSignInBegin> {
    const nowMs = this.http.now()
    if (args.provider === EOauthProvider.Anthropic) {
      const pkce = await anthropicPkce()
      return {
        flow: EProviderSignInFlow.PasteCode,
        attemptId: this.seal({
          provider: EOauthProvider.Anthropic,
          userId: args.userId,
          expiresAtMs: nowMs + PASTE_ATTEMPT_TTL_MS,
          ...pkce,
        }),
        authorizeUrl: anthropicManualAuthorizeUrl(pkce),
        expiresInMs: PASTE_ATTEMPT_TTL_MS,
      }
    }
    const device = await providerCall(() => openaiStartDevice({ fetch: this.http.fetch }))
    return {
      flow: EProviderSignInFlow.DeviceCode,
      attemptId: this.seal({
        provider: EOauthProvider.OpenAI,
        userId: args.userId,
        expiresAtMs: nowMs + device.expiresInMs,
        deviceAuthId: device.deviceAuthId,
        userCode: device.userCode,
      }),
      userCode: device.userCode,
      verificationUrl: device.verificationUrl,
      intervalMs: device.intervalMs,
      expiresInMs: device.expiresInMs,
    }
  }

  async complete(args: { userId: string; attemptId: string; code: string }): Promise<AccountDto> {
    const attempt = this.open(args)
    if (attempt.provider !== EOauthProvider.Anthropic)
      throw new BadRequestException(
        'that sign-in finishes by approving the device code, not a paste',
      )
    if (this.http.now() > attempt.expiresAtMs) throw expired()
    const login = await providerCall(() =>
      anthropicExchangePasted({
        fetch: this.http.fetch,
        pasted: args.code,
        pkce: {
          verifier: attempt.verifier,
          challenge: attempt.challenge,
          state: attempt.state,
        },
        nowMs: () => this.http.now(),
      }),
    )
    return this.storeLogin({
      userId: args.userId,
      provider: attempt.provider,
      login,
    })
  }

  async poll(args: { userId: string; attemptId: string }): Promise<ProviderSignInPoll> {
    const attempt = this.open(args)
    if (attempt.provider !== EOauthProvider.OpenAI)
      throw new BadRequestException('that sign-in finishes with a pasted code, not by polling')
    if (this.http.now() > attempt.expiresAtMs) return { status: EProviderSignInPoll.Expired }
    const polled = await providerCall(() =>
      openaiPollDevice({
        fetch: this.http.fetch,
        deviceAuthId: attempt.deviceAuthId,
        userCode: attempt.userCode,
        nowMs: () => this.http.now(),
      }),
    )
    if (polled.status === EDevicePoll.Pending) return { status: EProviderSignInPoll.Pending }
    const account = await this.storeLogin({
      userId: args.userId,
      provider: attempt.provider,
      login: polled.login,
    })
    return { status: EProviderSignInPoll.Complete, account }
  }

  private async storeLogin(args: {
    userId: string
    provider: EOauthProvider
    login: OauthLogin
  }): Promise<AccountDto> {
    const connectionId = `oauth_${randomUUID()}`
    const access = await this.connections.upload({
      userId: args.userId,
      connectionId,
      draft: { provider: args.provider, tokens: args.login.tokens },
    })
    const { scopes, accountId } = args.login.tokens
    const providerAccountId = access.providerAccountId ?? accountId
    const secret: SecretInput = {
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: access.accessToken,
        refreshToken: '',
        expiresAt: access.expiresAt,
        ...(scopes === undefined ? {} : { scopes }),
        ...(providerAccountId === undefined ? {} : { accountId: providerAccountId }),
      },
      authority: {
        url: this.env.get('BETTER_AUTH_URL'),
        connectionId,
        authorizationId: access.authorizationId,
        generation: access.generation,
        refreshAfter: access.refreshAfter,
      },
    }
    const provider = AUTH_PROVIDER_OF[args.provider]
    const account = await this.replaceOrAdd({
      userId: args.userId,
      oauthProvider: args.provider,
      login: args.login,
      secret,
    })
    await this.accounts.setActive({
      userId: args.userId,
      draft: { provider, accountId: account.id },
    })
    return account
  }

  private async replaceOrAdd(args: {
    userId: string
    oauthProvider: EOauthProvider
    login: OauthLogin
    secret: SecretInput
  }): Promise<AccountDto> {
    const provider = AUTH_PROVIDER_OF[args.oauthProvider]
    const held =
      args.login.email === undefined
        ? null
        : await db.orm.public.AgentAccount.first({
            userId: args.userId,
            provider,
            kind: EAuthKind.Oauth,
            email: args.login.email,
          })
    if (held !== null) {
      const previous = await this.accounts.read({
        userId: args.userId,
        accountId: held.id,
      })
      await this.accounts.replaceSecret({
        userId: args.userId,
        accountId: held.id,
        secret: args.secret,
      })
      await this.retireConnection({
        userId: args.userId,
        secret: previous.secret,
      })
      const refreshed = await this.accounts.list({ userId: args.userId })
      const account = refreshed.find((candidate) => candidate.id === held.id)
      if (account !== undefined) return account
    }
    return this.accounts.add({
      userId: args.userId,
      draft: {
        provider,
        label: labelFor({ provider: args.oauthProvider, login: args.login }),
        origin: EAccountOrigin.Login,
        secret: args.secret,
        ...(args.login.email === undefined ? {} : { email: args.login.email }),
        ...(args.login.subscription === undefined ? {} : { subscription: args.login.subscription }),
      },
    })
  }

  private async retireConnection(args: {
    userId: string
    secret: AccountSecretDto
  }): Promise<void> {
    if (args.secret.kind !== EAuthKind.Oauth || args.secret.authority === undefined) return
    await this.connections
      .remove({
        userId: args.userId,
        connectionId: args.secret.authority.connectionId,
      })
      .catch((error: unknown) => {
        if (!(error instanceof NotFoundException)) throw error
      })
  }

  private seal(attempt: SignInAttempt): string {
    return sealAttempt({ cipher: this.cipher, attempt })
  }

  private open(args: { userId: string; attemptId: string }): SignInAttempt {
    return openAttempt({
      cipher: this.cipher,
      attemptId: args.attemptId,
      userId: args.userId,
    })
  }
}
