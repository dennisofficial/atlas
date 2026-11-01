import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai'
import {
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
  type SharedV4ProviderOptions,
} from '@ai-sdk/provider'

import {
  EAuthKind,
  EAuthProvider,
  secretOf,
  type AccountId,
  type Credential,
  type CredentialPort,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../credentials/credential-error'
import { CODEX_PLAN_LABEL } from '../models/provider-ids'
import { isConfirmedAuthRefusal } from './auth-repair'
import { failingAs, withFailureAccount } from './failure-account'
import { withStreamProvenance } from './stream-provenance'
import { openaiCacheOptions } from './openai-cache'
import { admittedByAccount, type ProviderAdmission } from './provider-admission'
import { providerKey } from './provider-key'
import { withOpenAiCompatibleReasoning } from './openai-reasoning'
import { generationFromStream } from './stream-generation'

// A ChatGPT subscription token is only good against the codex backend, never api.openai.com. The
// transport is the Responses API under /backend-api/codex with the account id as a header and the
// request shaped the way codex shapes it (store off, encrypted reasoning content carried so a
// follow-up turn can thread it back). Constants verified against openai/codex `codex-rs`.
const CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex'

const SUBSCRIPTION_REQUEST: SharedV4ProviderOptions = {
  openai: { store: false, include: ['reasoning.encrypted_content'] },
}

type AuthorizedModel = { model: LanguageModelV4; credential: Credential }

const provenanceOf = (args: { credential: Credential; providerId: string; modelId: string }) => ({
  accountId: args.credential.accountId,
  providerId: args.providerId,
  modelId: args.modelId,
  authorizationDelivered: true,
})

const terminalResponse = (part: LanguageModelV4StreamPart): boolean => {
  if (part.type !== 'raw') return false
  const event = part.rawValue
  if (typeof event !== 'object' || event === null || !('type' in event)) return false
  return event.type === 'response.completed' || event.type === 'response.incomplete'
}

const settingsOf = (credential: Credential): OpenAIProviderSettings => {
  if (credential.kind === EAuthKind.ApiKey) return { apiKey: credential.apiKey }

  if (credential.providerAccountId === undefined)
    throw new CredentialError({
      failure: ECredentialFailure.Unreadable,
      message:
        'The OpenAI login Atlas holds carries no ChatGPT account id. Sign in again with /auth.',
    })

  return {
    apiKey: credential.accessToken,
    baseURL: CHATGPT_BASE_URL,
    headers: {
      'chatgpt-account-id': credential.providerAccountId,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
    },
  }
}

export const mergedProviderOptions = (args: {
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

export function createOpenAiModel(args: {
  credentials: CredentialPort
  providerId: string
  modelId: string
  accountId?: AccountId | undefined
  admission?: ProviderAdmission | undefined
  fetch?: OpenAIProviderSettings['fetch'] | undefined
}): LanguageModelV4 {
  const authorizedModel = async (): Promise<AuthorizedModel> => {
    const credential = await args.credentials.read({
      provider: EAuthProvider.OpenAI,
      accountId: args.accountId,
    })
    providerKey({ credential, label: CODEX_PLAN_LABEL })

    const provider = createOpenAI({
      name: args.providerId,
      ...settingsOf(credential),
      ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
    }).responses(args.modelId)

    const model = admittedByAccount({
      admission: args.admission,
      model: provider,
      credential,
      providerId: args.providerId,
      modelId: args.modelId,
    })
    return { model, credential }
  }

  // The codex request shape applies to a subscription; a metered api key must not carry it. The
  // extended-retention ask is the mirror image: the codex backend 400s on prompt_cache_retention
  // (verified live 2026-09-10), so only api.openai.com ever sees it.
  const shaped = ({
    authorized,
    options,
  }: {
    authorized: AuthorizedModel
    options: LanguageModelV4CallOptions
  }): LanguageModelV4CallOptions => {
    const defaults =
      authorized.credential.kind === EAuthKind.Oauth
        ? SUBSCRIPTION_REQUEST
        : openaiCacheOptions({ modelId: args.modelId })

    const providerOptions = mergedProviderOptions({
      defaults,
      call: options.providerOptions,
    })

    const resolved = providerOptions === undefined ? options : { ...options, providerOptions }
    return withOpenAiCompatibleReasoning({
      namespace: args.providerId.split('.')[0]?.trim() ?? '',
      options: resolved,
    })
  }

  const identity = { providerId: args.providerId, modelId: args.modelId }

  const throughACredentialTheServerAccepts = async <TResult>(
    call: (authorized: AuthorizedModel) => PromiseLike<TResult>,
  ): Promise<TResult> => {
    const authorized = await authorizedModel()

    try {
      return await call(authorized)
    } catch (error) {
      withFailureAccount({
        error,
        ...provenanceOf({ ...identity, credential: authorized.credential }),
      })
      if (!isConfirmedAuthRefusal(error)) throw error

      await args.credentials.discard(authorized.credential)

      const retried = await authorizedModel()
      if (secretOf(retried.credential) === secretOf(authorized.credential)) throw error

      return await failingAs({
        ...provenanceOf({ ...identity, credential: retried.credential }),
        run: () => call(retried),
      })
    }
  }

  // The codex backend rejects a non-streaming request with 400 "Stream must be set to true"
  // (verified live 2026-10-06), so a subscription generation is a collected stream.
  return {
    specificationVersion: 'v4',
    provider: args.providerId,
    modelId: args.modelId,
    supportedUrls: {},
    doGenerate: (options) =>
      throughACredentialTheServerAccepts(async (authorized) => {
        const shapedOptions = shaped({ authorized, options })
        if (authorized.credential.kind !== EAuthKind.Oauth)
          return authorized.model.doGenerate(shapedOptions)

        return generationFromStream({
          result: await authorized.model.doStream({ ...shapedOptions, includeRawChunks: true }),
          isTerminalPart: terminalResponse,
        })
      }),
    doStream: (options) =>
      throughACredentialTheServerAccepts(async (authorized) =>
        withStreamProvenance({
          result: await authorized.model.doStream(shaped({ authorized, options })),
          provenance: provenanceOf({ ...identity, credential: authorized.credential }),
        }),
      ),
  }
}
