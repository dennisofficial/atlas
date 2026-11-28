import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common'
import {
  anthropicExchangeCode,
  anthropicExchangePasted,
  anthropicManualAuthorizeUrl,
  anthropicPkce,
  DeviceCodeDisabledError,
  EDevicePoll,
  OauthHttpError,
  OauthResponseError,
  openaiExchangeCode,
  openaiPollDevice,
  openaiStartDevice,
  type OauthLogin,
} from '@dltech/atlas-credentials/provider-oauth'
import {
  EOauthProvider,
  EProviderSignInFlow,
  EProviderSignInPoll,
  type AccountDto,
  type ProviderSignInBegin,
  type ProviderSignInPoll,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { AccountsService } from '../accounts/accounts.service'
import { OauthConnectionsService } from '../oauth-connections/oauth-connections.service'
import { ProviderHttp } from './provider-http'
import { beginLoopback } from './provider-loopback-sign-in'
import { storeLogin, type SignInStoreDeps } from './provider-sign-in-store'
import {
  ESignInAttempt,
  openAttempt,
  sealAttempt,
  type LoopbackAttempt,
  type PasteAttempt,
  type SignInAttempt,
} from './sign-in-attempt'

export const PASTE_ATTEMPT_TTL_MS = 10 * 60 * 1000

const expired = (): BadRequestException =>
  new BadRequestException('that sign-in expired — start the sign-in again')

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

  async begin(args: {
    userId: string
    provider: EOauthProvider
    flow?: EProviderSignInFlow.Loopback | undefined
    redirectUri?: string | undefined
  }): Promise<ProviderSignInBegin> {
    const nowMs = this.http.now()
    if (args.flow === EProviderSignInFlow.Loopback)
      return beginLoopback({
        ...args,
        redirectUri: args.redirectUri,
        nowMs,
        ttlMs: PASTE_ATTEMPT_TTL_MS,
        seal: (attempt) => this.seal(attempt),
      })
    if (args.provider === EOauthProvider.Anthropic) {
      const pkce = await anthropicPkce()
      return {
        flow: EProviderSignInFlow.PasteCode,
        attemptId: this.seal({
          kind: ESignInAttempt.Paste,
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
        kind: ESignInAttempt.Device,
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
    if (attempt.kind === ESignInAttempt.Device)
      throw new BadRequestException(
        'that sign-in finishes by approving the device code, not a paste',
      )
    if (this.http.now() > attempt.expiresAtMs) throw expired()
    const login = await providerCall(() => this.exchange({ attempt, code: args.code }))
    return storeLogin({
      deps: this.storeDeps(),
      userId: args.userId,
      provider: attempt.provider,
      login,
    })
  }

  private exchange(args: {
    attempt: PasteAttempt | LoopbackAttempt
    code: string
  }): Promise<OauthLogin> {
    const { attempt } = args
    if (attempt.kind === ESignInAttempt.Paste)
      return anthropicExchangePasted({
        fetch: this.http.fetch,
        pasted: args.code,
        pkce: {
          verifier: attempt.verifier,
          challenge: attempt.challenge,
          state: attempt.state,
        },
        nowMs: () => this.http.now(),
      })

    if (attempt.provider === EOauthProvider.Anthropic)
      return anthropicExchangeCode({
        fetch: this.http.fetch,
        code: args.code,
        pkce: {
          verifier: attempt.verifier,
          challenge: attempt.challenge,
          state: attempt.state,
        },
        redirectUri: attempt.redirectUri,
        nowMs: () => this.http.now(),
      })

    return openaiExchangeCode({
      fetch: this.http.fetch,
      authorizationCode: args.code,
      codeVerifier: attempt.verifier,
      redirectUri: attempt.redirectUri,
      nowMs: () => this.http.now(),
    })
  }

  async poll(args: { userId: string; attemptId: string }): Promise<ProviderSignInPoll> {
    const attempt = this.open(args)
    if (attempt.kind !== ESignInAttempt.Device)
      throw new BadRequestException(
        attempt.kind === ESignInAttempt.Paste
          ? 'that sign-in finishes with a pasted code, not by polling'
          : 'that sign-in finishes in the browser, not by polling',
      )
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
    const account = await storeLogin({
      deps: this.storeDeps(),
      userId: args.userId,
      provider: attempt.provider,
      login: polled.login,
    })
    return { status: EProviderSignInPoll.Complete, account }
  }

  private storeDeps(): SignInStoreDeps {
    return { env: this.env, accounts: this.accounts, connections: this.connections }
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
