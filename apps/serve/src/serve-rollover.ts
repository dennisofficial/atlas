import type { SandboxRolloverReply } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLog } from './serve-log'

export const ROLLOVER_REASON = 'rollover: the provider session nears its hard limit'
export const ROLLOVER_RETRY_MS = 30_000

export type RolloverRequest = () => Promise<SandboxRolloverReply>

export type ServeRollover = {
  bind: (args: {
    drain: (given: { reason: string }) => Promise<unknown>
    rearm: () => void
  }) => void
  start: (request: RolloverRequest) => void
  beforeRetire: (given: { reason: string }) => Promise<void>
}

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function createServeRollover(args: {
  log: ServeLog
  retryMs?: number | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
}): ServeRollover {
  const sleep = args.sleep ?? ((ms: number) => Bun.sleep(ms))
  let bound: Parameters<ServeRollover['bind']>[0] | undefined
  let request: RolloverRequest | undefined
  let draining = false

  const handOff = async (): Promise<void> => {
    if (request === undefined) return
    for (let attempt = 1; ; attempt += 1) {
      try {
        const reply = await request()
        if (reply.dispatched) {
          args.log({ event: EServeEvent.RolloverDispatched, attempt })
          return
        }
        args.log({
          event: EServeEvent.RolloverHandoffFailed,
          attempt,
          reason: 'another wake holds the sandbox claim',
        })
      } catch (failure) {
        args.log({ event: EServeEvent.RolloverHandoffFailed, attempt, reason: reasonOf(failure) })
      }
      await sleep(args.retryMs ?? ROLLOVER_RETRY_MS)
    }
  }

  return {
    bind: (given) => {
      bound = given
    },
    start: (given) => {
      if (draining || bound === undefined) return
      const target = bound
      draining = true
      request = given
      args.log({ event: EServeEvent.RolloverRequested, reason: ROLLOVER_REASON })
      void target.drain({ reason: ROLLOVER_REASON }).catch((failure: unknown) => {
        draining = false
        args.log({
          event: EServeEvent.RolloverHandoffFailed,
          step: 'drain',
          reason: reasonOf(failure),
        })
        target.rearm()
      })
    },
    beforeRetire: async ({ reason }) => {
      if (reason !== ROLLOVER_REASON) return
      await handOff()
    },
  }
}
