import { APICallError } from '@ai-sdk/provider'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'

import {
  EAdmissionCompletion,
  ECredentialFence,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  toAccountId,
  type AdmissionCompletion,
  type AdmissionPermit,
  type AvailabilityKey,
  type ClockPort,
  type CredentialRevision,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

import { InMemoryCredentialAvailability } from '../../credentials/credential-availability'
import { admittedModel } from '../admitted-model'

export const START_MS = Date.parse('2026-11-01T12:00:00.000Z')

export class RecordingAvailability extends InMemoryCredentialAvailability {
  readonly completions: AdmissionCompletion[] = []
  readonly promotions: NormalizedProviderFailure[] = []

  override async complete(args: {
    permit: AdmissionPermit
    completion: AdmissionCompletion
  }): Promise<void> {
    this.completions.push(args.completion)
    await super.complete(args)
  }

  override async promoteProbe(args: {
    permit: AdmissionPermit
    failure: NormalizedProviderFailure
  }): Promise<void> {
    this.promotions.push(args.failure)
    await super.promoteProbe(args)
  }
}

export const key: AvailabilityKey = {
  accountId: toAccountId('acct_1'),
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
}
export const revision: CredentialRevision = { fence: ECredentialFence.Replaced, value: 1 }

export const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

export const generated: LanguageModelV4GenerateResult = {
  content: [{ type: 'text', text: 'pong' }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: USAGE,
  warnings: [],
}

export const delta = (text: string): LanguageModelV4StreamPart => ({
  type: 'text-delta',
  id: 'one',
  delta: text,
})
export const finish: LanguageModelV4StreamPart = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: undefined },
  usage: USAGE,
}

export const quotaFault = (): APICallError =>
  new APICallError({
    message: 'You exceeded your current quota',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: 429,
    responseBody: '{"error":{"type":"insufficient_quota","message":"quota"}}',
  })

export const streamOf = (
  parts: readonly LanguageModelV4StreamPart[],
): LanguageModelV4StreamResult => ({
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  }),
})

export const gatedStream = (args: {
  head: readonly LanguageModelV4StreamPart[]
}): {
  result: LanguageModelV4StreamResult
  release: (tail: LanguageModelV4StreamPart[]) => void
} => {
  let release: (tail: LanguageModelV4StreamPart[]) => void = () => undefined
  const gate = new Promise<LanguageModelV4StreamPart[]>((resolve) => {
    release = resolve
  })
  let headSent = false
  return {
    release,
    result: {
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        async pull(controller) {
          if (!headSent) {
            headSent = true
            for (const part of args.head) controller.enqueue(part)
            return
          }
          for (const part of await gate) controller.enqueue(part)
          controller.close()
        },
      }),
    },
  }
}

export const harness = (inner: Partial<LanguageModelV4>) => {
  let nowMs = START_MS
  const clock: ClockPort = { now: () => new Date(nowMs).toISOString() }
  const availability = new RecordingAvailability({ clock })
  const dispatched: LanguageModelV4CallOptions[] = []
  const model: LanguageModelV4 = {
    specificationVersion: 'v4',
    provider: key.providerId,
    modelId: key.modelId,
    supportedUrls: {},
    doGenerate: async (options) => {
      dispatched.push(options)
      return generated
    },
    doStream: async (options) => {
      dispatched.push(options)
      return streamOf([delta('a'), finish])
    },
    ...inner,
  }
  return {
    availability,
    dispatched,
    advance: (ms: number) => {
      nowMs += ms
    },
    admitted: admittedModel({
      model,
      key,
      revision: async () => revision,
      availability,
      clock,
    }),
  }
}

export const drain = async (
  stream: ReadableStream<LanguageModelV4StreamPart>,
): Promise<LanguageModelV4StreamPart[]> => {
  const reader = stream.getReader()
  const parts: LanguageModelV4StreamPart[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return parts
    parts.push(value)
  }
}

export const closeBarrier = async (rig: ReturnType<typeof harness>): Promise<void> => {
  const decision = await rig.availability.admit({ key, revision })
  if (!decision.admitted) throw new Error('expected admission')
  await rig.availability.complete({
    permit: decision.permit,
    completion: {
      outcome: EAdmissionCompletion.Failed,
      failure: {
        kind: EProviderFailureKind.Quota,
        scope: EProviderFailureScope.Credential,
        retry: EProviderRetry.Never,
        message: 'out of quota',
      },
    },
  })
  rig.availability.completions.length = 0
}
