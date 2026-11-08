import type {
  AssemblyPipeline,
  MediaUrlResolver,
  ModelPort,
  ThreadId,
  WorkspaceStepReport,
} from '@dltech/atlas-core'
import type {
  NormalizeFailure,
  SaidUploadsPort,
  ToolEffectResolver,
  ToolRegistry,
} from '@dltech/atlas-agent'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
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

export type PrepareResult =
  | { ok: true; warnings?: readonly string[] | undefined }
  | { ok: false; reason: string }

export type FoundPullRequest = { number: number; url: string }

export type PullRequestFinder = {
  find(args: {
    repo: string
    branch: string
    signal: AbortSignal
  }): Promise<FoundPullRequest | null>
}

export type PullRequestSource = {
  finder: PullRequestFinder
  repoOf(repoPath: string): string | null
}

export type PrepareStepReporter = (step: WorkspaceStepReport) => void

export type SessionRuntime = {
  remoteCalls: RemoteCalls
  model: ModelPort
  tools: ToolRegistry
  daemonTools: ReadonlySet<string>
  effectOf: ToolEffectResolver
  assembly: AssemblyPipeline
  uploads?: SaidUploadsPort | undefined
  mediaUrls?: MediaUrlResolver | undefined
  normalizeFailure: NormalizeFailure
  launchDirectory: string
  watchedRepos(): Promise<readonly string[]>
  baseBranchOf(repoPath: string): string | null
  pullRequests?: PullRequestSource | undefined
  plugins?: ComposedPlugins | undefined
  runningShells(): Promise<number>
  prepare(onStep?: PrepareStepReporter): Promise<PrepareResult>
  subscribePrepareOutput?(listener: (text: string) => void): void
  stop(): Promise<void>
  release(): Promise<void>
}

export type SessionRuntimeFactory = (args: {
  sessionId: string
  threadId: ThreadId
  epoch: number
  signal: AbortSignal
}) => Promise<SessionRuntime>
