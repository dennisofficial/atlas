import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'

import {
  EAuthKind,
  EAuthProvider,
  type Credential,
  type CredentialPort,
  type AccountId,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../credential-error'
import { CODEX_PLAN_LABEL, OPENAI_PROVIDER_ID } from '../provider-ids'
import { providerKey } from '../provider-key'
import { withStreamProvenance } from '../stream-provenance'
import { throughACredentialTheServerAccepts } from './authorized-call'
import { mergedProviderOptions } from './merge-options'
import { openaiCacheOptions } from './openai-cache'
import { withOpenAiCompatibleReasoning } from './openai-reasoning'
import { generationFromStream } from './stream-generation'

// A ChatGPT subscription token is only good against the codex backend, which speaks the Responses
// API with the account id as a header: https://github.com/openai/codex/tree/main/codex-rs
const CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex'

const SUBSCRIPTION_REQUEST: SharedV4ProviderOptions = {
  openai: { store: false, include: ['reasoning.encrypted_content'] },
}

const CODEX_SUPPORTED_URLS: LanguageModelV4['supportedUrls'] = { 'image/*': [/^https:\/\//] }

type AuthorizedModel = { model: LanguageModelV4; credential: Credential }

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

export function createOpenAiModel(args: {
  credentials: CredentialPort
  modelId: string
  accountId?: AccountId | undefined
  providerOptions?: (() => SharedV4ProviderOptions | undefined) | undefined
  fetch?: OpenAIProviderSettings['fetch'] | undefined
}): LanguageModelV4 {
  const authorize = async (): Promise<AuthorizedModel> => {
    const credential = await args.credentials.read({
      provider: EAuthProvider.OpenAI,
      accountId: args.accountId,
    })
    providerKey({ credential, label: CODEX_PLAN_LABEL })

    const model = createOpenAI({
      name: OPENAI_PROVIDER_ID,
      ...settingsOf(credential),
      ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
    }).responses(args.modelId)
    return { model, credential }
  }

  const shaped = ({
    authorized,
    options,
  }: {
    authorized: AuthorizedModel
    options: LanguageModelV4CallOptions
  }): LanguageModelV4CallOptions => {
    const requestDefaults =
      authorized.credential.kind === EAuthKind.Oauth
        ? SUBSCRIPTION_REQUEST
        : openaiCacheOptions({ modelId: args.modelId })

    const providerOptions = mergedProviderOptions({
      defaults: requestDefaults,
      call: mergedProviderOptions({
        defaults: args.providerOptions?.(),
        call: options.providerOptions,
      }),
    })

    const resolved = providerOptions === undefined ? options : { ...options, providerOptions }
    return withOpenAiCompatibleReasoning({ namespace: OPENAI_PROVIDER_ID, options: resolved })
  }

  const through = <TResult>(call: (authorized: AuthorizedModel) => PromiseLike<TResult>) =>
    throughACredentialTheServerAccepts({
      credentials: args.credentials,
      providerId: OPENAI_PROVIDER_ID,
      modelId: args.modelId,
      authorize,
      call,
    })

  // The codex backend rejects a non-streaming request with 400 "Stream must be set to true", so a
  // subscription generation is a collected stream: https://github.com/openai/codex/tree/main/codex-rs
  return {
    specificationVersion: 'v4',
    provider: OPENAI_PROVIDER_ID,
    modelId: args.modelId,
    supportedUrls: CODEX_SUPPORTED_URLS,
    doGenerate: (options) =>
      through(async (authorized) => {
        const shapedOptions = shaped({ authorized, options })
        if (authorized.credential.kind !== EAuthKind.Oauth)
          return authorized.model.doGenerate(shapedOptions)

        return generationFromStream({
          result: await authorized.model.doStream({ ...shapedOptions, includeRawChunks: true }),
          isTerminalPart: terminalResponse,
        })
      }),
    doStream: (options) =>
      through(async (authorized) =>
        withStreamProvenance({
          result: await authorized.model.doStream(shaped({ authorized, options })),
          provenance: {
            accountId: authorized.credential.accountId,
            providerId: OPENAI_PROVIDER_ID,
            modelId: args.modelId,
            authorizationDelivered: true,
          },
        }),
      ),
  }
}
