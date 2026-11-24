import type { PodResizeDeps, PodResizeSession } from '../pod-resize-run'

export const sessionOf = (over: Partial<PodResizeSession> = {}): PodResizeSession => ({
  sessionId: 'session-a',
  podSessionId: null,
  podSizeGeneration: 2,
  podDesiredVcpus: 4,
  podDesiredMemoryGb: 16,
  podDesiredDiskGb: null,
  archivedAt: null,
  ...over,
})

export const depsOf = (over: Partial<PodResizeDeps> = {}) => {
  const resizes: {
    sandboxSessionId: string
    shape: { vcpus: number; memoryGb: number }
    diskGb?: number | undefined
  }[] = []
  const wakes: { sessionId: string; epoch: number }[] = []
  const applied: { sessionId: string; vcpus: number; memoryGb: number; generation: number }[] = []
  const failures: { sessionId: string; generation: number; error: string }[] = []
  const requeues: { payload: unknown; delaySeconds: number }[] = []
  const waits: { sessionId: string; generation: number }[] = []
  const started: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }[] = []
  const notices: { sessionId: string; notice: unknown }[] = []
  const sleeps: number[] = []
  const consumed = new Set<number>()
  const heldIds = new Set<string>()
  const epochs = new Map<string, number>()
  const deps: PodResizeDeps = {
    session: async () => sessionOf(),
    resize: async (args) => {
      resizes.push({
        sandboxSessionId: args.sandboxSessionId,
        shape: args.shape,
        ...(args.diskGb === undefined ? {} : { diskGb: args.diskGb }),
      })
      return 'restarted'
    },
    wake: async (args) => {
      wakes.push(args)
    },
    lease: async (args) => ({
      live: heldIds.has(args.sessionId),
      epoch: epochs.get(args.sessionId) ?? 0,
    }),
    placed: async (args) => [{ sessionId: args.podSessionId, archivedAt: null }],
    started: async (args) => {
      const inboxId = started.length + 1
      started.push(args)
      return { inboxId }
    },
    consumed: async (args) => consumed.has(args.inboxId),
    notice: async (args) => {
      notices.push(args)
    },
    sleep: async (args) => {
      sleeps.push(args.ms)
    },
    recordApplied: async (args) => {
      applied.push(args)
    },
    recordFailed: async (args) => {
      failures.push(args)
    },
    busy: async () => ({ busy: false, running: [] }),
    recordWaiting: async (args) => {
      waits.push(args)
    },
    requeue: async (args) => {
      requeues.push(args)
    },
    ...over,
  }
  return {
    deps,
    resizes,
    wakes,
    applied,
    failures,
    requeues,
    waits,
    started,
    notices,
    sleeps,
    consumed,
    heldIds,
    epochs,
  }
}

export const payload = { sessionId: 'session-a', generation: 2, vcpus: 4, memoryGb: 16 }
