import { createAnthropic, type AnthropicProviderSettings } from '@ai-sdk/anthropic'
import {
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type SharedV4ProviderOptions,
} from '@ai-sdk/provider'

import {
  ANTHROPIC_PROVIDER_ID,
  EAuthKind,
  secretOf,
  type AccountId,
  type Credential,
  type CredentialPort,
} from '@dltech/atlas-core'

import { CLAUDE_PLAN_LABEL } from '../models/provider-ids'
import { isConfirmedAuthRefusal } from './auth-repair'
import { failingAs, withFailureAccount } from './failure-account'
import { admittedByAccount, type ProviderAdmission } from './provider-admission'
import { providerKey } from './provider-key'
import { withStreamProvenance } from './stream-provenance'
import { withAnthropicCompatibleReasoning } from './anthropic-reasoning'
import { withAnthropicSubscriptionAttribution } from './anthropic-subscription-attribution'

export type AnthropicFetch = NonNullable<AnthropicProviderSettings['fetch']>

export type AnthropicProviderOptions =
  | SharedV4ProviderOptions
  | (() => SharedV4ProviderOptions | undefined)

type AuthorizedModel = { model: LanguageModelV4; credential: Credential }

export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20'
export { ANTHROPIC_PROVIDER_ID }

export type AnthropicOauthModelArgs = {
  credentials: CredentialPort
  modelId: string
  accountId?: AccountId | undefined
  admission?: ProviderAdmission | undefined
  providerOptions?: AnthropicProviderOptions | undefined
  baseURL?: string | undefined
  fetch?: AnthropicFetch | undefined
}

const mergedProviderOptions = (args: {
  defaults: SharedV4ProviderOptions | undefined
  call: SharedV4ProviderOptions | undefined
}): SharedV4ProviderOptions | undefined => {
  if (args.defaults === undefined) return args.call
  if (args.call === undefined) return args.defaults

  const merged: SharedV4ProviderOptions = { ...args.defaults }
  for (const [namespace, values] of Object.entries(args.call)) {
    merged[namespace] = { ...merged[namespace], ...values }
  }
  return merged
}

// @ai-sdk/anthropic 4.0.41 resolves auth headers lazily, per request, so a provider built with no
// credential is legal as long as no request is made through it. `supportedUrls` reads pure config.
const supportedUrlsWithoutACredential = (modelId: string) =>
  createAnthropic()(modelId).supportedUrls

const heldProviderOptions = (
  held: AnthropicProviderOptions | undefined,
): SharedV4ProviderOptions | undefined => (typeof held === 'function' ? held() : held)

// A pair another holder of the same OAuth lineage has rotated away comes back as 401 "OAuth access
// token has been revoked." while its own `expiresAt` still reads fresh, so the server's refusal is
// the only signal that the pair is dead.
const provenanceOf = (args: { credential: Credential; modelId: string }) => ({
  accountId: args.credential.accountId,
  providerId: ANTHROPIC_PROVIDER_ID,
  modelId: args.modelId,
  authorizationDelivered: true,
})

const authOf = (credential: Credential): AnthropicProviderSettings =>
  credential.kind === EAuthKind.Oauth
    ? { authToken: credential.accessToken, headers: { 'anthropic-beta': ANTHROPIC_OAUTH_BETA } }
    : { apiKey: credential.apiKey }

export function createAnthropicOauthModel(args: AnthropicOauthModelArgs): LanguageModelV4 {
  const authorizedModel = async (): Promise<AuthorizedModel> => {
    const credential = await args.credentials.read({ accountId: args.accountId })
    providerKey({ credential, label: CLAUDE_PLAN_LABEL })

    const provider = createAnthropic({
      name: ANTHROPIC_PROVIDER_ID,
      ...authOf(credential),
      ...(args.baseURL === undefined ? {} : { baseURL: args.baseURL }),
      ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
    })(args.modelId)

    const model = admittedByAccount({
      admission: args.admission,
      model: provider,
      credential,
      providerId: ANTHROPIC_PROVIDER_ID,
      modelId: args.modelId,
    })
    return { model, credential }
  }

  const withDefaultProviderOptions = (
    options: LanguageModelV4CallOptions,
  ): LanguageModelV4CallOptions => {
    const providerOptions = mergedProviderOptions({
      defaults: heldProviderOptions(args.providerOptions),
      call: options.providerOptions,
    })

    if (providerOptions === undefined) return options
    return { ...options, providerOptions }
  }

  // The billing header routes a claude.ai subscription; a metered API key needs no routing and must
  // not carry it.
  const attributed = ({
    authorized,
    options,
  }: {
    authorized: AuthorizedModel
    options: LanguageModelV4CallOptions
  }): LanguageModelV4CallOptions =>
    withAnthropicCompatibleReasoning({
      namespace: ANTHROPIC_PROVIDER_ID,
      options:
        authorized.credential.kind === EAuthKind.Oauth
          ? withAnthropicSubscriptionAttribution(withDefaultProviderOptions(options))
          : withDefaultProviderOptions(options),
    })

  const throughACredentialTheServerAccepts = async <TResult>(
    call: (authorized: AuthorizedModel) => PromiseLike<TResult>,
  ): Promise<TResult> => {
    const authorized = await authorizedModel()

    try {
      return await call(authorized)
    } catch (error) {
      withFailureAccount({
        error,
        ...provenanceOf({ credential: authorized.credential, modelId: args.modelId }),
      })
      if (!isConfirmedAuthRefusal(error)) throw error

      await args.credentials.discard(authorized.credential)

      const retried = await authorizedModel()
      if (secretOf(retried.credential) === secretOf(authorized.credential)) throw error

      return await failingAs({
        ...provenanceOf({ credential: retried.credential, modelId: args.modelId }),
        run: () => call(retried),
      })
    }
  }

  return {
    specificationVersion: 'v4',
    provider: ANTHROPIC_PROVIDER_ID,
    modelId: args.modelId,
    supportedUrls: supportedUrlsWithoutACredential(args.modelId),

    doGenerate: (options) =>
      throughACredentialTheServerAccepts((authorized) =>
        authorized.model.doGenerate(attributed({ authorized, options })),
      ),

    doStream: (options) =>
      throughACredentialTheServerAccepts(async (authorized) =>
        withStreamProvenance({
          result: await authorized.model.doStream(attributed({ authorized, options })),
          provenance: provenanceOf({ credential: authorized.credential, modelId: args.modelId }),
        }),
      ),
  }
}
