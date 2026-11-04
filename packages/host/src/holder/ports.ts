import type { AssemblyPipeline, ModelPort, ThreadId } from '@dltech/atlas-core'
import type { NormalizeFailure, ToolEffectResolver, ToolRegistry } from '@dltech/atlas-agent'
import type { LiveFrame } from '@dltech/atlas-protocol'

import type { RemoteCalls } from '../calls/remote-calls'

export type HostBus = {
  onWake(listener: (sessionId: string) => void): () => void
  wake(sessionId: string): Promise<void>
  live(args: { sessionId: string; frame: LiveFrame }): void
}

export type HostTimers = {
  now(): number
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  random(): number
}

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
  stop(): Promise<void>
  release(): Promise<void>
}

export type SessionRuntimeFactory = (args: {
  sessionId: string
  threadId: ThreadId
  epoch: number
  signal: AbortSignal
}) => Promise<SessionRuntime>

export type StatusState = 'starting' | 'thinking' | 'idle'

export const statusFrame = (args: { state: StatusState }): LiveFrame => ({
  type: 'status',
  state: args.state,
})
