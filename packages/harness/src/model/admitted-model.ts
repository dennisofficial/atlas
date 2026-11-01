import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'

import {
  EAdmissionCompletion,
  type AdmissionCompletion,
  type AdmissionPermit,
  type AvailabilityKey,
  type ClockPort,
  type CredentialAvailabilityPort,
  type CredentialRevision,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

import { ModelAdmissionBlockedError } from './admission-blocked'
import { normalizeProviderFailure } from './failure'
import { attachProvenance } from './failure-provenance'

export type AdmittedModelArgs = {
  model: LanguageModelV4
  key: AvailabilityKey
  revision: () => Promise<CredentialRevision>
  availability: CredentialAvailabilityPort
  clock: ClockPort
}

export function admittedModel(args: AdmittedModelArgs): LanguageModelV4 {
  const { key, availability } = args

  const admit = async (): Promise<AdmissionPermit> => {
    const decision = await availability.admit({ key, revision: await args.revision() })
    if (!decision.admitted) throw new ModelAdmissionBlockedError({ block: decision.block })
    return decision.permit
  }

  const failureOf = (error: unknown): NormalizedProviderFailure => {
    attachProvenance({
      error,
      provenance: { ...key, authorizationDelivered: true },
    })
    return normalizeProviderFailure({
      cause: error,
      providerId: key.providerId,
      modelId: key.modelId,
      nowMs: Date.parse(args.clock.now()),
    })
  }

  const complete = (args: {
    permit: AdmissionPermit
    completion: AdmissionCompletion
  }): Promise<void> => availability.complete(args)

  const settleFailure = async (settle: {
    permit: AdmissionPermit
    error: unknown
    signal: AbortSignal | undefined
  }): Promise<void> => {
    const { permit } = settle
    if (settle.signal?.aborted === true) {
      await complete({ permit, completion: { outcome: EAdmissionCompletion.Cancelled } })
      return
    }
    const failure = failureOf(settle.error)
    if (permit.probe) {
      await availability.promoteProbe({ permit, failure })
      return
    }
    await complete({ permit, completion: { outcome: EAdmissionCompletion.Failed, failure } })
  }

  const observed = (observing: {
    stream: ReadableStream<LanguageModelV4StreamPart>
    permit: AdmissionPermit
    signal: AbortSignal | undefined
  }): ReadableStream<LanguageModelV4StreamPart> => {
    const { permit, signal } = observing
    const reader = observing.stream.getReader()
    let settled = false
    let promoted = false
    let finished = false
    let cancelled = false
    let pendingFailure: NormalizedProviderFailure | undefined

    const settle = async (completion: AdmissionCompletion): Promise<void> => {
      if (settled) return
      settled = true
      await complete({ permit, completion })
    }

    const failed = (failure: NormalizedProviderFailure): Promise<void> =>
      settle({ outcome: EAdmissionCompletion.Failed, failure })

    const ended = (): Promise<void> => {
      if (pendingFailure !== undefined) return failed(pendingFailure)
      if (finished) return settle({ outcome: EAdmissionCompletion.Succeeded })
      if (cancelled || signal?.aborted === true)
        return settle({ outcome: EAdmissionCompletion.Cancelled })
      return settle({ outcome: EAdmissionCompletion.Succeeded })
    }

    const observe = async (part: LanguageModelV4StreamPart): Promise<void> => {
      if (part.type === 'finish') finished = true
      if (part.type !== 'error' || signal?.aborted === true) return

      const failure = failureOf(part.error)
      if (permit.probe && !promoted) {
        promoted = true
        pendingFailure = failure
        await availability.promoteProbe({ permit, failure })
        return
      }
      await failed(failure)
    }

    return new ReadableStream<LanguageModelV4StreamPart>({
      async pull(controller) {
        let read: Awaited<ReturnType<typeof reader.read>>
        try {
          read = await reader.read()
        } catch (fault) {
          if (cancelled) return
          if (signal?.aborted === true) await settle({ outcome: EAdmissionCompletion.Cancelled })
          else await failed(failureOf(fault))
          reader.releaseLock()
          throw fault
        }

        if (cancelled) return
        if (read.done) {
          await ended()
          reader.releaseLock()
          controller.close()
          return
        }
        await observe(read.value)
        controller.enqueue(read.value)
      },
      cancel: async (reason) => {
        cancelled = true
        await ended()
        return reader.cancel(reason).finally(() => reader.releaseLock())
      },
    })
  }

  const dispatch = async <TResult>(call: {
    signal: AbortSignal | undefined
    run: () => PromiseLike<TResult>
  }): Promise<{ result: TResult; permit: AdmissionPermit }> => {
    const permit = await admit()
    try {
      return { result: await call.run(), permit }
    } catch (error) {
      await settleFailure({ permit, error, signal: call.signal })
      throw error
    }
  }

  return {
    get specificationVersion(): 'v4' {
      return args.model.specificationVersion
    },
    get provider() {
      return args.model.provider
    },
    get modelId() {
      return args.model.modelId
    },
    get supportedUrls() {
      return args.model.supportedUrls
    },
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const { result, permit } = await dispatch({
        signal: options.abortSignal,
        run: () => args.model.doGenerate(options),
      })
      await complete({ permit, completion: { outcome: EAdmissionCompletion.Succeeded } })
      return result
    },
    doStream: async (options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> => {
      const { result, permit } = await dispatch({
        signal: options.abortSignal,
        run: () => args.model.doStream(options),
      })
      return {
        ...result,
        stream: observed({ stream: result.stream, permit, signal: options.abortSignal }),
      }
    },
  }
}
