import type { AssemblyPipeline, ModelPort, ThreadId, WorkspaceStepReport } from '@dltech/atlas-core'
import type { NormalizeFailure, ToolEffectResolver, ToolRegistry } from '@dltech/atlas-agent'
import type { LiveFrame } from '@dltech/atlas-protocol'

import type { RemoteCalls } from '../calls/remote-calls'

export type HostBus = {
  onWake(listener: (sessionId: string) => void): () => void
  onResync(listener: () => void): () => void
  live(args: { sessionId: string; frame: LiveFrame }): Promise<void>
}

export const fireLive = (args: { bus: HostBus; sessionId: string; frame: LiveFrame }): void => {
  const { bus, ...frameArgs } = args
  void bus.live(frameArgs).catch(() => undefined)
}

export type HostPresence = {
  register(): Promise<number>
  onLost(listener: (hostId: number) => void): () => void
  abandon(hostId: number): Promise<void>
  close(): Promise<void>
}

export type HostTimers = {
  now(): number
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  random(): number
}

export type PrepareResult = { ok: true } | { ok: false; reason: string }

export type PrepareStepReporter = (step: WorkspaceStepReport) => void

export type SessionRuntime = {
  remoteCalls: RemoteCalls
  model: ModelPort
  tools: ToolRegistry
  daemonTools: ReadonlySet<string>
  effectOf: ToolEffectResolver
  assembly: AssemblyPipeline
  normalizeFailure: NormalizeFailure
  launchDirectory: string
  watchedRepos(): Promise<readonly string[]>
  runningShells(): Promise<number>
  prepare(onStep?: PrepareStepReporter): Promise<PrepareResult>
  stop(): Promise<void>
  release(): Promise<void>
}

export type SessionRuntimeFactory = (args: {
  sessionId: string
  threadId: ThreadId
  epoch: number
  signal: AbortSignal
}) => Promise<SessionRuntime>
