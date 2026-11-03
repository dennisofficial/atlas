import {
  defaultPipeline,
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  ToolDefinition,
  toThreadId,
  type ThreadId,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  ScriptedModel,
  SequentialIds,
  fakeToolRegistry,
  type ScriptedModelStep,
} from '@dltech/atlas-agent/testing'
import {
  createInMemoryDaemon,
  inMemoryDaemonToken,
  type InMemoryDaemon,
} from '@dltech/atlas-protocol/testing'
import type { LiveFrame } from '@dltech/atlas-protocol'

import { RemoteCalls } from '../../calls/remote-calls'
import type { DaemonConnector } from '../../calls/socket'
import type { HostBus, HostTimers, SessionRuntime } from '../ports'
import { SessionHolder } from '../session-holder'

export const SANDBOX = 'holder-test-sandbox'
export const SECRET = 'holder-test-secret'
export const SESSION = 'session-rig'
export const THREAD = 'thread-rig'
export const THREAD_ID = toThreadId(THREAD)

export class FakeClock implements HostTimers {
  current = 0
  private seq = 0
  private readonly timers = new Map<number, { at: number; handler: () => void }>()

  now(): number {
    return this.current
  }

  setTimeout(handler: () => void, ms: number): unknown {
    this.seq += 1
    this.timers.set(this.seq, { at: this.current + ms, handler })
    return this.seq
  }

  clearTimeout(timer: unknown): void {
    this.timers.delete(timer as number)
  }

  random(): number {
    return 0.5
  }

  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (next === undefined) break
      this.timers.delete(next[0])
      this.current = next[1].at
      next[1].handler()
    }
    this.current = target
  }

  pendingWithin(ms: number): boolean {
    return [...this.timers.values()].some((timer) => timer.at <= this.current + ms)
  }
}

export class FakeBus implements HostBus {
  readonly wakes: string[] = []
  readonly frames: { sessionId: string; frame: LiveFrame }[] = []
  private readonly listeners = new Set<(sessionId: string) => void>()

  onWake(listener: (sessionId: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async wake(sessionId: string): Promise<void> {
    this.wakes.push(sessionId)
    for (const listener of [...this.listeners]) listener(sessionId)
  }

  live(args: { sessionId: string; frame: LiveFrame }): void {
    this.frames.push({ ...args })
  }

  statuses(sessionId: string): readonly string[] {
    return this.frames
      .filter((entry) => entry.sessionId === sessionId && entry.frame.type === 'status')
      .map((entry) => (entry.frame as { state: string }).state)
  }
}

export type RigRuntime = SessionRuntime & {
  model: ScriptedModel
  stopped: boolean
  released: boolean
  ackedScopes: string[]
}

class BashTool extends ToolDefinition {
  readonly name = 'bash'
  readonly description = 'run a shell command in the sandbox'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({ command: z.string() })

  constructor(private readonly calls: RemoteCalls) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    const result = await this.calls.invoke({
      key: args.idempotencyKey,
      op: { op: 'exec', argv: ['/bin/sh', '-c', bashCommandOf(args.input)] },
      signal: args.signal,
    })
    if (result.status !== 'ok') return { ok: false, reason: result.error.message }
    const value = result.value as { outcome: string; stdout?: string; exitCode: number | null }
    if (value.outcome === 'cancelled') return { ok: false, reason: 'cancelled' }
    return { ok: true, output: value.stdout ?? '', modelText: value.stdout ?? '' }
  }
}

const bashCommandOf = (input: unknown): string => {
  if (typeof input === 'object' && input !== null && 'command' in input) {
    return String((input as { command: unknown }).command)
  }
  return 'true'
}

export type ScriptRef = { current: readonly ScriptedModelStep[] }

export type HolderRig = {
  plane: ControlPlane
  bus: FakeBus
  clock: FakeClock
  ids: SequentialIds
  holder: SessionHolder
  daemon: InMemoryDaemon
  script: ScriptRef
  runtimes: RigRuntime[]
  post(text: string): Promise<{ inboxId: number }>
  postStop(): Promise<{ inboxId: number }>
  wake(): Promise<void>
  flush(): Promise<void>
  events(): Promise<{ type: string; seq: number; epoch: number; bootId?: string | null }[]>
}

export const makeRig = async (args: {
  holderId?: string | undefined
  script?: readonly ScriptedModelStep[] | undefined
  daemon?: InMemoryDaemon | undefined
  clock?: FakeClock | undefined
  bus?: FakeBus | undefined
  plane?: ControlPlane | undefined
  maxSessions?: number | undefined
  ttlMs?: number | undefined
  renewEveryMs?: number | undefined
  fenceMarginMs?: number | undefined
  inboxPollMs?: number | undefined
  idleMinutes?: number | undefined
}): Promise<HolderRig> => {
  const clock = args.clock ?? new FakeClock()
  const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
  const plane = args.plane ?? new ControlPlane({ store })
  const bus = args.bus ?? new FakeBus()
  const ids = new SequentialIds()
  const daemon =
    args.daemon ??
    (await createInMemoryDaemon({ version: 'test', sandboxName: SANDBOX, secret: SECRET }))
  const script: ScriptRef = { current: args.script ?? [{ text: 'ok' }] }
  const runtimes: RigRuntime[] = []

  const runtimeFor = async ({
    sessionId,
    epoch,
  }: {
    sessionId: string
    threadId: ThreadId
    epoch: number
    signal: AbortSignal
  }): Promise<SessionRuntime> => {
    const model = new ScriptedModel(script.current)
    const calls = new RemoteCalls({
      sessionId,
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () =>
        Promise.resolve<DaemonConnector>((handlers) =>
          Promise.resolve(daemon.connectRaw(handlers)),
        ),
      timers: clock,
      onFenced: () => {},
    })
    calls.open({ epoch })
    const ackedScopes: string[] = []
    const originalAckScope = calls.ackScope.bind(calls)
    calls.ackScope = async (args: { scopeKey: string; count?: number | undefined }) => {
      ackedScopes.push(args.scopeKey)
      return originalAckScope(args)
    }
    const runtime: RigRuntime = {
      remoteCalls: calls,
      model,
      tools: fakeToolRegistry([new BashTool(calls)]),
      daemonTools: new Set(['bash']),
      ackedScopes,
      effectOf: () => EToolEffect.Read,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      normalizeFailure: ({ message }) => ({
        kind: EProviderFailureKind.Network,
        scope: EProviderFailureScope.Route,
        retry: EProviderRetry.Transient,
        message,
      }),
      launchDirectory: '/w',
      stopped: false,
      released: false,
      stop: async () => {
        runtime.stopped = true
        calls.close()
      },
      release: async () => {
        runtime.released = true
        calls.close()
      },
    }
    runtimes.push(runtime)
    return runtime
  }

  const holder = new SessionHolder({
    holderId: args.holderId ?? 'holder-a',
    plane,
    bus,
    timers: clock,
    runtimes: runtimeFor,
    ids,
    maxSessions: args.maxSessions ?? 4,
    ttlMs: args.ttlMs ?? 30_000,
    renewEveryMs: args.renewEveryMs ?? 5_000,
    fenceMarginMs: args.fenceMarginMs ?? 5_000,
    inboxPollMs: args.inboxPollMs ?? 2_000,
    idleMinutes: args.idleMinutes ?? 30,
  })

  return {
    plane,
    bus,
    clock,
    ids,
    holder,
    daemon,
    script,
    runtimes,
    post: (text) =>
      plane.post({ sessionId: SESSION, kind: 'message', payload: JSON.stringify({ text }) }),
    postStop: () => plane.post({ sessionId: SESSION, kind: 'stop', payload: '{}' }),
    wake: () => bus.wake(SESSION),
    flush: async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    },
    events: async () => {
      const out: { type: string; seq: number; epoch: number; bootId?: string | null }[] = []
      let afterSeq = 0
      for (;;) {
        const page = await plane.readEvents({
          threadId: THREAD_ID,
          afterSeq,
          limit: 1000,
          visible: false,
        })
        for (const event of page.events) {
          out.push({
            type: event.type,
            seq: event.seq,
            epoch: event.epoch,
            ...(event.type === 'tool-dispatched' ? { bootId: event.bootId ?? null } : {}),
          })
        }
        if (page.next === undefined) return out
        afterSeq = page.next
      }
    },
  }
}

export const seedSession = async (rig: HolderRig): Promise<void> => {
  await rig.plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
}

export const flushUntil = async (args: {
  check: () => Promise<boolean> | boolean
  attempts?: number
  advanceMs?: number
  clock?: FakeClock
}): Promise<boolean> => {
  for (let i = 0; i < (args.attempts ?? 50); i += 1) {
    if (await args.check()) return true
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (args.clock !== undefined) {
      const step = args.advanceMs ?? 2_000
      if (args.clock.pendingWithin(step)) args.clock.advance(step)
    }
  }
  return args.check()
}

export const postAndRun = async (rig: HolderRig, text: string): Promise<{ inboxId: number }> => {
  const posted = await rig.post(text)
  await rig.wake()
  await rig.flush()
  return posted
}
