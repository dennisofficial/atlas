import { describe, expect, it } from 'bun:test'

import {
  ANTHROPIC_PROVIDER_ID,
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  EAvailabilityControl,
  EEffort,
  EImageTier,
  revisionOf,
  toAccountId,
  type AccountId,
  type AvailabilityKey,
  type CredentialPort,
  type CredentialRevision,
  type ModelCard,
  type StoredAccount,
} from '@dltech/atlas-core'

import { InMemoryCredentialAvailability } from '../../credentials/credential-availability'
import { apiKeyCredential } from '../../credentials/testing'
import { ModelAdmissionBlockedError } from '../../model/admission-blocked'
import type { ProviderAdapter } from '../adapter'
import { AnthropicAdapter } from '../anthropic-adapter'
import { InferenceAdapter, INFERENCE_PROVIDER_ID } from '../inference-adapter'
import { OpenAiAdapter, OPENAI_PROVIDER_ID } from '../openai-adapter'
import { OpenRouterAdapter, OPENROUTER_PROVIDER_ID } from '../openrouter-adapter'
import type { ProviderAdmission } from '../provider-admission'
import { generatedText, recordingFetch } from './recording-fetch'

const ACCOUNT: AccountId = toAccountId('acc_test')

const stored: StoredAccount = {
  id: ACCOUNT,
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: 'Work',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-test' },
  authorizationRevision: 3,
}

const stampedRevision = revisionOf(stored)

const credentials: CredentialPort = {
  read: async () => ({
    ...apiKeyCredential({ apiKey: 'sk-test' }),
    revision: stampedRevision,
  }),
  discard: async () => undefined,
}

const cardOn = (providerId: string): ModelCard => ({
  ref: { providerId, modelId: 'a-model' },
  label: 'A model',
  api: 'openai-completions',
  contextWindow: 200_000,
  imageTier: EImageTier.Standard,
})

type Case = {
  name: string
  providerId: string
  build: (args: {
    admission: ProviderAdmission
    fetch: ReturnType<typeof recordingFetch>['fetch']
    credentials?: CredentialPort
  }) => ProviderAdapter
}

const CASES: readonly Case[] = [
  {
    name: 'anthropic',
    providerId: ANTHROPIC_PROVIDER_ID,
    build: ({ admission, credentials: held = credentials }) =>
      new AnthropicAdapter({
        credentials: held,
        admission,
        cards: [cardOn(ANTHROPIC_PROVIDER_ID)],
      }),
  },
  {
    name: 'openai',
    providerId: OPENAI_PROVIDER_ID,
    build: ({ admission, fetch, credentials: held = credentials }) =>
      new OpenAiAdapter({
        credentials: held,
        admission,
        fetch,
        cards: [cardOn(OPENAI_PROVIDER_ID)],
      }),
  },
  {
    name: 'openrouter',
    providerId: OPENROUTER_PROVIDER_ID,
    build: ({ admission, credentials: held = credentials }) =>
      new OpenRouterAdapter({
        credentials: held,
        admission,
        cards: [cardOn(OPENROUTER_PROVIDER_ID)],
      }),
  },
  {
    name: 'inference',
    providerId: INFERENCE_PROVIDER_ID,
    build: ({ admission, fetch, credentials: held = credentials }) =>
      new InferenceAdapter({
        credentials: held,
        admission,
        fetch,
        cards: [cardOn(INFERENCE_PROVIDER_ID)],
      }),
  },
]

const rig = () => {
  const clock = { now: () => '2026-11-01T12:00:00.000Z' }
  const availability = new InMemoryCredentialAvailability({ clock })
  const admission: ProviderAdmission = { availability, clock }
  const recorder = recordingFetch({
    body: generatedText('pong'),
    contentType: 'application/json',
  })
  return { availability, admission, recorder }
}

const refusingRig = () => {
  const { admission, recorder } = rig()
  const asked: CredentialRevision[] = []
  class Refusing extends InMemoryCredentialAvailability {
    override async admit(args: { key: AvailabilityKey; revision: CredentialRevision }) {
      asked.push(args.revision)
      return {
        admitted: false as const,
        block: { key: args.key, snapshot: await this.inspect(args) },
      }
    }
  }
  return {
    admission: {
      ...admission,
      availability: new Refusing({ clock: admission.clock }),
    },
    recorder,
    asked,
  }
}

describe.each(CASES)('the $name adapter admission', ({ providerId, build }) => {
  const keyOf = (): AvailabilityKey => ({
    accountId: ACCOUNT,
    providerId,
    modelId: 'a-model',
  })

  it('blocks dispatch through a credential the authority holds closed', async () => {
    const { availability, admission, recorder } = rig()
    await availability.control({
      key: keyOf(),
      revision: revisionOf(stored),
      action: EAvailabilityControl.Pause,
    })
    const model = build({ admission, fetch: recorder.fetch }).model({
      card: cardOn(providerId),
      effort: () => EEffort.Medium,
    })

    await expect(model.doGenerate({ prompt: [] })).rejects.toBeInstanceOf(
      ModelAdmissionBlockedError,
    )
    await expect(model.doStream({ prompt: [] })).rejects.toBeInstanceOf(ModelAdmissionBlockedError)
    expect(recorder.requests).toHaveLength(0)
  })

  it('asks the authority with the revision stamped on the credential it read', async () => {
    const { admission, recorder, asked } = refusingRig()
    const model = build({ admission, fetch: recorder.fetch }).model({
      card: cardOn(providerId),
      effort: () => EEffort.Medium,
    })

    await Promise.resolve(model.doGenerate({ prompt: [] })).catch(() => undefined)

    expect(asked).toEqual([stampedRevision])
    expect(recorder.requests).toHaveLength(0)
  })

  it('keeps the revision read with the secret when the account is replaced after the read', async () => {
    const { admission, recorder, asked } = refusingRig()
    const replacedRevision: CredentialRevision = {
      ...stampedRevision,
      value: stampedRevision.value + 1,
    }
    let currentRevision = stampedRevision
    const racing: CredentialPort = {
      read: async () => {
        const read = {
          ...apiKeyCredential({ apiKey: 'sk-old' }),
          revision: currentRevision,
        }
        currentRevision = replacedRevision
        return read
      },
      discard: async () => undefined,
    }
    const model = build({
      admission,
      fetch: recorder.fetch,
      credentials: racing,
    }).model({ card: cardOn(providerId), effort: () => EEffort.Medium })

    await Promise.resolve(model.doGenerate({ prompt: [] })).catch(() => undefined)

    expect(asked).toEqual([stampedRevision])
    expect(asked).not.toContainEqual(replacedRevision)
  })
})
