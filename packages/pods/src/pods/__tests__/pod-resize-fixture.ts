import type { PodResizeDeps, PodResizeSession } from '../pod-resize-run'

export const sessionOf = (over: Partial<PodResizeSession> = {}): PodResizeSession => ({
  sessionId: 'session-a',
  podSessionId: null,
  podSizeGeneration: 2,
  podDesiredVcpus: 4,
  podDesiredMemoryGb: 16,
  podDesiredDiskGb: null,
  archivedAt: null,
  sandboxStatus: null,
  podParkedAt: null,
  ...over,
})

export const WAIT_AT = '2026-11-25T10:00:00.000Z'

export const depsOf = (over: Partial<PodResizeDeps> = {}) => {
  const resizes: {
    sandboxSessionId: string
    shape: { vcpus: number; memoryGb: number }
    diskGb?: number | undefined
  }[] = []
  const wakes: { sessionId: string; epoch: number }[] = []
  const parks: { sandboxSessionId: string }[] = []
  const applied: { sessionId: string; vcpus: number; memoryGb: number; generation: number }[] = []
  const failures: { sessionId: string; generation: number; error: string }[] = []
  const waits: { sessionId: string; generation: number; since: string }[] = []
  const claims: { sessionId: string; generation: number; since: string }[] = []
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
    park: async (args) => {
      parks.push(args)
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
      return true
    },
    claimWait: async (args) => {
      claims.push(args)
      return true
    },
    now: () => WAIT_AT,
    ...over,
  }
  return {
    deps,
    resizes,
    wakes,
    parks,
    applied,
    failures,
    waits,
    claims,
    started,
    notices,
    sleeps,
    consumed,
    heldIds,
    epochs,
  }
}

export const payload = { sessionId: 'session-a', generation: 2, vcpus: 4, memoryGb: 16 }
