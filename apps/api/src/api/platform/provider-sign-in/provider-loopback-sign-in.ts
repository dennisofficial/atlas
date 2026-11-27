import { BadRequestException } from '@nestjs/common'
import {
  anthropicLoopbackAuthorizeUrl,
  anthropicPkce,
  openaiBrowserAuthorizeUrl,
  type Pkce,
} from '@dltech/atlas-credentials/provider-oauth'
import { anthropicLoopbackRedirectOk, openaiLoopbackRedirectOk } from '@dltech/atlas-core'
import { EOauthProvider, EProviderSignInFlow, type ProviderSignInBegin } from '@dltech/atlas-wire'
import { PROVIDER_LABEL } from './provider-sign-in-store'
import { ESignInAttempt, type LoopbackAttempt } from './sign-in-attempt'

const LOOPBACK_OF: Record<
  EOauthProvider,
  {
    redirectOk: (redirectUri: string) => boolean
    authorize: (args: { pkce: Pkce; redirectUri: string }) => string
  }
> = {
  [EOauthProvider.Anthropic]: {
    redirectOk: anthropicLoopbackRedirectOk,
    authorize: anthropicLoopbackAuthorizeUrl,
  },
  [EOauthProvider.OpenAI]: {
    redirectOk: openaiLoopbackRedirectOk,
    authorize: (args) =>
      openaiBrowserAuthorizeUrl({
        redirectUri: args.redirectUri,
        challenge: args.pkce.challenge,
        state: args.pkce.state,
      }),
  },
}

export async function beginLoopback(args: {
  userId: string
  provider: EOauthProvider
  redirectUri: string | undefined
  nowMs: number
  ttlMs: number
  seal: (attempt: LoopbackAttempt) => string
}): Promise<ProviderSignInBegin> {
  const redirectUri = args.redirectUri
  if (redirectUri === undefined)
    throw new BadRequestException(
      'a browser sign-in needs the loopback address its browser comes back to',
    )
  const loopback = LOOPBACK_OF[args.provider]
  if (!loopback.redirectOk(redirectUri))
    throw new BadRequestException(
      `${PROVIDER_LABEL[args.provider]} only returns to its own loopback address, not ${redirectUri}`,
    )

  const pkce = await anthropicPkce()
  return {
    flow: EProviderSignInFlow.Loopback,
    attemptId: args.seal({
      kind: ESignInAttempt.Loopback,
      provider: args.provider,
      userId: args.userId,
      expiresAtMs: args.nowMs + args.ttlMs,
      ...pkce,
      redirectUri,
    }),
    authorizeUrl: loopback.authorize({ pkce, redirectUri }),
    state: pkce.state,
    expiresInMs: args.ttlMs,
  }
}
