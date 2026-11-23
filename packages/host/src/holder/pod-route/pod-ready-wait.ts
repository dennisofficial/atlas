import type { PodCallBus } from '../pod-call-port'
import type { HolderDemand } from '../holder-demand'
import { EPodReach, type PodReach } from './pod-reach'

export type PodReadyWait = {
  done: Promise<PodReach>
  settle(reach: PodReach): void
}

export const armPodReady = (args: {
  sessionId: string
  selfHostId: number | undefined
  demand: HolderDemand
  bus: PodCallBus | undefined
  timeoutMs: number
  signal?: AbortSignal | undefined
}): PodReadyWait => {
  let settled = false
  let offReady: (() => void) | undefined
  let settle: (reach: PodReach) => void = () => undefined
  const done = new Promise<PodReach>((resolve) => {
    const wait = args.demand.waitForLocal({
      sessionId: args.sessionId,
      timeoutMs: args.timeoutMs,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
    settle = (reach: PodReach): void => {
      if (settled) return
      settled = true
      wait.cancel()
      offReady?.()
      resolve(reach)
    }
    offReady = args.bus?.onReady((ready) => {
      if (ready.sessionId !== args.sessionId) return
      settle(
        ready.hostId === args.selfHostId
          ? { kind: EPodReach.Local }
          : { kind: EPodReach.Remote, hostId: ready.hostId },
      )
    })
    void wait.done.then((held) =>
      settle(held ? { kind: EPodReach.Local } : { kind: EPodReach.Unreachable }),
    )
  })
  return { done, settle: (reach) => settle(reach) }
}

export const awaitPodReady = (args: Parameters<typeof armPodReady>[0]): Promise<PodReach> =>
  armPodReady(args).done
