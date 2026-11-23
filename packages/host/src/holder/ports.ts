import type {
  AssemblyPipeline,
  ClassifierPort,
  ClassifierStatus,
  ESetupPhase,
  MediaUrlResolver,
  ModelChoice,
  ModelPort,
  ModelRef,
  ModelRole,
  PromptSpawner,
  SpawnFile,
  ThreadId,
  WorkspaceStepReport,
} from '@dltech/atlas-core'
import type {
  NormalizeFailure,
  QualityStagePort,
  SaidUploadsPort,
  ToolEffectResolver,
  ToolRegistry,
} from '@dltech/atlas-agent'
import type { TracePort } from '@dltech/atlas-observability'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
import type { LiveFrame } from '@dltech/atlas-protocol'

import type { RemoteCalls } from '../calls/remote-calls'
import type { WorkspaceGate } from '../calls/workspace-gate'

export type HostBus = {
  onWake(listener: (sessionId: string) => void): () => void
  onResync(listener: () => void): () => void
  live(args: { key: string; frame: LiveFrame }): Promise<void>
  panelHold(args: { sessionId: string; ttlMs: number }): Promise<void>
  onPanelHold(listener: (hold: { sessionId: string; ttlMs: number }) => void): () => void
}

export const fireLive = (args: { bus: HostBus; key: string; frame: LiveFrame }): void => {
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

export type CapturedBase = { repoPath: string; base: string }

export type BootNotice = { slot: string; content: string }

export type PrepareResult =
  | {
      ok: true
      warnings?: readonly string[] | undefined
      bases?: readonly CapturedBase[]
      notices?: readonly BootNotice[] | undefined
    }
  | { ok: false; reason: string }

export type SetupLifecycle =
  | { phase: ESetupPhase.Started; script: string }
  | {
      phase: ESetupPhase.Finished
      script: string
      ok: boolean
      durationMs: number
      output: string
    }

export type PrepareStepReporter = (step: WorkspaceStepReport) => void

export type RoleModelRequest = { role: ModelRole; root?: ModelChoice | undefined }

export type RoleModelChoice = ModelChoice & { unavailable?: ModelRef | undefined }

export type SessionRuntime = {
  remoteCalls: RemoteCalls
  workspaceGate?: WorkspaceGate | undefined
  trace?: TracePort | undefined
  model: ModelPort
  classifier: ClassifierPort
  classifierStatus: ClassifierStatus
  rotation: { autoRotateAtPercent: number }
  modelChoice: ModelChoice
  choiceFor(request: RoleModelRequest): RoleModelChoice
  modelLabelOf(ref: ModelRef): string
  modelOf(choice: ModelChoice): ModelPort
  tools: ToolRegistry
  daemonTools: ReadonlySet<string>
  quality?: QualityStagePort | undefined
  effectOf: ToolEffectResolver
  assembly: AssemblyPipeline
  uploads?: SaidUploadsPort | undefined
  placeContextFiles?: (args: {
    files: readonly SpawnFile[]
  }) => Promise<{ written: number; refused: readonly string[] }>
  mediaUrls?: MediaUrlResolver | undefined
  normalizeFailure: NormalizeFailure
  launchDirectory: string
  watchedRepos(): Promise<readonly string[]>
  onRepo?: ((listener: (repoPath: string) => void) => () => void) | undefined
  watchedCheckouts(): Promise<readonly string[]>
  onCheckout?: ((listener: (checkoutPath: string) => void) => () => void) | undefined
  baseBranchOf(repoPath: string): string | null
  plugins?: ComposedPlugins | undefined
  runningShells(): Promise<number>
  terminalStreams?: (() => number) | undefined
  panelHolds?: (() => number) | undefined
  env?: (() => Promise<Record<string, string>>) | undefined
  prepare(onStep?: PrepareStepReporter): Promise<PrepareResult>
  subscribePrepareOutput?(listener: (text: string) => void): void
  subscribeSetup?(listener: (lifecycle: SetupLifecycle) => void): void
  stop(): Promise<void>
  release(): Promise<void>
}

export type PodPeers = {
  placed(args: { podSessionId: string; excludeSessionId: string }): Promise<number>
}

export type SessionRuntimeFactory = (args: {
  sessionId: string
  podSessionId: string
  podPeers?: PodPeers | undefined
  threadId: ThreadId
  epoch: number
  signal: AbortSignal
  spawner?: PromptSpawner | undefined
}) => Promise<SessionRuntime>
