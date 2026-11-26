import type { Lease } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { BranchSet } from '@dltech/atlas-protocol'
import type {
  PodCallReply,
  PodCallReplyOutcome,
  PodCallRequest,
  PodReady,
  PodStreamFrame,
} from '@dltech/atlas-protocol'

import type { EventFrame } from '../../../calls/remote-calls'
import type { PodCallBus } from '../../pod-call-port'

export const SET: BranchSet = {
  repoPath: '/w',
  head: 'aaa111',
  branches: [{ name: 'main', sha: 'aaa111', pushRemote: null }],
  worktrees: [{ path: '/w', branch: 'main', sha: 'aaa111', detached: false }],
  remotes: [{ name: 'origin', url: 'git@github.com:acme/app.git' }],
  checkouts: ['main'],
}

export const branchesFrame = (): EventFrame => ({
  kind: 'event',
  event: { type: 'git.branches', set: SET },
})

export type PlaneState = {
  holderHostId: number | null
  wantsHolder: boolean
  live?: boolean | undefined
  parkedAt?: string | null | undefined
}

export type PlaneCalls = {
  reads: number
  wakes: { sessionIds: string[] }[]
  revokes: { sessionId: string; wantsHolder: boolean }[]
}

export type PlaneHooks = {
  onWake?(state: PlaneState): void
  reads?: readonly PlaneState[] | undefined
}

export const fakePlaneOf = (
  initial: PlaneState,
  hooks: PlaneHooks = {},
): { plane: ControlPlane; state: PlaneState; calls: PlaneCalls } => {
  const state: PlaneState = { ...initial }
  const calls: PlaneCalls = { reads: 0, wakes: [], revokes: [] }
  const scripted = [...(hooks.reads ?? [])]
  const leaseOf = (sessionId: string): Lease => ({
    sessionId,
    epoch: 1,
    holderHostId: state.holderHostId,
    wantsHolder: state.wantsHolder,
    attempts: 0,
    retryAfter: null,
  })
  const plane = {
    async currentLease(params: { sessionId: string }): Promise<{ lease: Lease; live: boolean }> {
      calls.reads += 1
      const next = scripted.shift()
      if (next !== undefined) Object.assign(state, next)
      return {
        lease: leaseOf(params.sessionId),
        live: state.live ?? state.holderHostId !== null,
      }
    },
    async readSession(): Promise<{ podParkedAt: string | null }> {
      return { podParkedAt: state.parkedAt ?? null }
    },
    async wake(params: { sessionIds: string[] }): Promise<void> {
      calls.wakes.push(params)
      hooks.onWake?.(state)
    },
    async revoke(params: { sessionId: string; wantsHolder: boolean }): Promise<Lease> {
      calls.revokes.push(params)
      state.wantsHolder = params.wantsHolder
      return leaseOf(params.sessionId)
    },
  } as unknown as ControlPlane
  return { plane, state, calls }
}

export class FakePodCallBus implements PodCallBus {
  readonly requesterId = 'requester-1'
  readonly requests: PodCallRequest[] = []
  readonly replies: PodCallReply[] = []
  readonly published: { streamId: string; frame: PodStreamFrame }[] = []
  readonly readies: PodReady[] = []
  readonly subscribed: string[] = []
  answer: (request: PodCallRequest) => PodCallReplyOutcome = () => ({ state: 'open' })
  private readonly requestListeners = new Set<(request: PodCallRequest) => void>()
  private readonly readyListeners = new Set<(ready: PodReady) => void>()
  private readonly frameListeners = new Map<string, Set<(frame: PodStreamFrame) => void>>()
  private subscribeGate: Promise<void> | undefined
  private openGate: (() => void) | undefined

  async request(args: {
    request: PodCallRequest
    timeoutMs: number
    signal?: AbortSignal | undefined
  }): Promise<PodCallReplyOutcome> {
    this.requests.push(args.request)
    return this.answer(args.request)
  }

  onRequest(listener: (request: PodCallRequest) => void): () => void {
    this.requestListeners.add(listener)
    return () => {
      this.requestListeners.delete(listener)
    }
  }

  async reply(args: { replyTo: string; reply: PodCallReply }): Promise<void> {
    this.replies.push(args.reply)
  }

  async publishFrame(args: { streamId: string; frame: PodStreamFrame }): Promise<void> {
    this.published.push(args)
    this.deliverFrame(args.streamId, args.frame)
  }

  deferSubscribe(): void {
    this.subscribeGate = new Promise((resolve) => {
      this.openGate = resolve
    })
  }

  releaseSubscribe(): void {
    this.openGate?.()
    this.openGate = undefined
  }

  async subscribeFrames(args: {
    streamId: string
    listener: (frame: PodStreamFrame) => void
  }): Promise<() => Promise<void>> {
    const gate = this.subscribeGate
    if (gate !== undefined) {
      await gate
      this.subscribeGate = undefined
    }
    this.subscribed.push(args.streamId)
    const listeners = this.frameListeners.get(args.streamId) ?? new Set()
    listeners.add(args.listener)
    this.frameListeners.set(args.streamId, listeners)
    return async () => {
      listeners.delete(args.listener)
      if (listeners.size === 0) this.frameListeners.delete(args.streamId)
    }
  }

  async ready(ready: PodReady): Promise<void> {
    this.readies.push(ready)
  }

  onReady(listener: (ready: PodReady) => void): () => void {
    this.readyListeners.add(listener)
    return () => {
      this.readyListeners.delete(listener)
    }
  }

  async close(): Promise<void> {
    this.requestListeners.clear()
    this.readyListeners.clear()
    this.frameListeners.clear()
  }

  emitRequest(request: PodCallRequest): void {
    for (const listener of [...this.requestListeners]) listener(request)
  }

  emitReady(ready: PodReady): void {
    for (const listener of [...this.readyListeners]) listener(ready)
  }

  deliverFrame(streamId: string, frame: PodStreamFrame): void {
    for (const listener of [...(this.frameListeners.get(streamId) ?? [])]) listener(frame)
  }

  listening(streamId: string): boolean {
    return (this.frameListeners.get(streamId)?.size ?? 0) > 0
  }
}
