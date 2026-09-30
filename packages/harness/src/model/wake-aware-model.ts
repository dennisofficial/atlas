import type { LanguageModelV4 } from '@ai-sdk/provider'

import { DEFAULT_JUMP_THRESHOLD_MS, type WakeSignal } from '../wake/wake-signals'
import { StreamStallError } from './errors'

type DoStreamOptions = Parameters<LanguageModelV4['doStream']>[0]

export const proxyDoStream = (
  model: LanguageModelV4,
  doStream: (options: DoStreamOptions) => ReturnType<LanguageModelV4['doStream']>,
): LanguageModelV4 =>
  new Proxy(model, {
    get: (target, property, receiver) =>
      property === 'doStream' ? doStream : Reflect.get(target, property, receiver),
  })

// A wake fires once but the retry above re-enters doStream; each attempt races its own deadline,
// so one aborted controller must not poison the attempt that follows.
export function wakeAbortsStream(args: {
  model: LanguageModelV4
  wake: WakeSignal
  freshWindowMs?: number | undefined
}): LanguageModelV4 {
  const freshWindowMs = args.freshWindowMs ?? DEFAULT_JUMP_THRESHOLD_MS

  const doStream = async (options: DoStreamOptions) => {
    const deadline = new AbortController()
    const followCaller = () => deadline.abort(options.abortSignal?.reason)
    options.abortSignal?.addEventListener('abort', followCaller, { once: true })

    const failOnWake = (reject: (error: unknown) => void) =>
      args.wake.subscribe(() => {
        const stall = new StreamStallError('the machine woke while the request was in flight')
        // The request dies so the half-open socket is abandoned, and the SDK's own error path —
        // doStream rejecting — is what turns the wake into the step failure; a bare abort only
        // ends the stream as a graceful abort part.
        deadline.abort(stall)
        reject(stall)
      })

    // Bun's keep-alive pool holds the sockets sleep stranded. `connection: close` still draws a
    // pooled socket — it only closes it after the response — so a post-wake attempt spends at most
    // one try on a stranded socket and the retry then runs on a fresh one. The SDK forwards
    // options.headers into the provider's request.
    const freshConnection = args.wake.wasWakeRecent(freshWindowMs)
      ? { headers: { ...options.headers, connection: 'close' } }
      : {}

    let wakeSeen: (() => void) | null = null
    const woken = new Promise<never>((_, reject) => {
      wakeSeen = failOnWake(reject)
    })
    woken.catch(() => undefined)
    const answered = args.model.doStream({
      ...options,
      ...freshConnection,
      abortSignal: deadline.signal,
    })
    const result = await Promise.race([answered, woken]).finally(() => wakeSeen?.())
    if (deadline.signal.aborted) throw deadline.signal.reason

    return {
      ...result,
      stream: failStreamOnWake({
        stream: result.stream,
        subscribe: args.wake.subscribe.bind(args.wake),
        abortRequest: () =>
          deadline.abort(new StreamStallError('the machine woke while the stream was open')),
      }),
    }
  }

  return proxyDoStream(args.model, doStream)
}

function failStreamOnWake<Part>(args: {
  stream: ReadableStream<Part>
  subscribe: (listener: () => void) => () => void
  abortRequest: () => void
}): ReadableStream<Part> {
  const reader = args.stream.getReader()
  let woken: StreamStallError | null = null
  const unsubscribe = args.subscribe(() => {
    woken = new StreamStallError('the machine woke while the stream was open')
    args.abortRequest()
    reader.cancel().catch(() => undefined)
  })

  const release = () => {
    unsubscribe()
    reader.releaseLock()
  }

  return new ReadableStream<Part>({
    async pull(controller) {
      if (woken !== null) {
        release()
        controller.error(woken)
        return
      }
      try {
        const { done, value } = await reader.read()
        if (woken !== null) {
          release()
          controller.error(woken)
          return
        }
        if (done) {
          release()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        release()
        controller.error(woken ?? error)
      }
    },
    cancel(reason) {
      release()
      return args.stream.cancel(reason)
    },
  })
}
