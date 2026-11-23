import {
  defaultPipeline,
  EClassifierFault,
  EEffort,
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  refKey,
  ToolDefinition,
  type ClassifierPort,
  type ModelPort,
  type SpawnFile,
  type ThreadId,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'
import type { SaidUploadsPort } from '@dltech/atlas-agent'
import {
  ScriptedModel,
  fakeToolRegistry,
  type ScriptedModelStep,
} from '@dltech/atlas-agent/testing'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
import { inMemoryDaemonToken, type InMemoryDaemon } from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../calls/remote-calls'
import { WorkspaceGate } from '../../calls/workspace-gate'
import { scopeDispatchedBootId } from '../../calls/call-scope'
import type {
  PrepareResult,
  PrepareStepReporter,
  RoleModelChoice,
  SessionRuntime,
  SetupLifecycle,
} from '../ports'
import { DaemonFileSystemPort } from '../../calls/ports/filesystem'
import { placeContextFiles } from '../place-context-files'
import { SANDBOX, SECRET, type FakeClock } from './rig-fakes'

export const CONTEXT_DIRECTORY = '/atlas/home/sessions/s-1/context'
const OFF_CLASSIFIER: ClassifierPort = {
  classify: async () => ({
    ok: false,
    fault: EClassifierFault.Unavailable,
    detail: 'the rig has no classifier',
  }),
}

export const RIG_MODEL_CHOICE = {
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.Medium,
  fast: false,
}

export type RigRuntime = SessionRuntime & {
  model: ModelPort
  modelOfCalls: RoleModelChoice[]
  stopped: boolean
  released: boolean
  ackedScopes: string[]
  placedContextFiles: readonly (readonly SpawnFile[])[]
  watched: string[]
}

export type ScriptRef = { current: readonly ScriptedModelStep[] }

class BashTool extends ToolDefinition {
  readonly name = 'bash'
  readonly description = 'run a shell command in the sandbox'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({
    command: z.string(),
    description: z.string().optional(),
    background: z.boolean().optional(),
  })

  constructor(
    private readonly calls: RemoteCalls,
    private readonly gate: WorkspaceGate | undefined,
  ) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    const workspace = await this.gate?.wait(args.signal)
    if (workspace !== undefined && workspace.state !== 'prepared') {
      return {
        ok: false,
        reason: workspace.state === 'failed' ? workspace.message : 'interrupted',
      }
    }
    const parsed = this.inputSchema.safeParse(args.input)
    const input = parsed.success ? parsed.data : { command: 'true' }
    if (input.background === true) return this.launchBackground({ args, input })
    const result = await this.calls.invoke({
      key: args.idempotencyKey,
      op: { op: 'exec', argv: ['/bin/sh', '-c', input.command] },
      signal: args.signal,
      dispatchedBootId: scopeDispatchedBootId(),
    })
    if (result.status !== 'ok') return { ok: false, reason: result.error.message }
    const value = result.value as {
      outcome: string
      stdout?: string
      exitCode: number | null
    }
    if (value.outcome === 'cancelled') return { ok: false, reason: 'cancelled' }
    return {
      ok: true,
      output: value.stdout ?? '',
      modelText: value.stdout ?? '',
    }
  }

  private async launchBackground({
    args,
    input,
  }: {
    args: ToolInvocation
    input: { command: string; description?: string | undefined }
  }): Promise<ToolOutcome> {
    const shellId = `shell-${crypto.randomUUID().slice(0, 8)}`
    const result = await this.calls.invoke({
      key: args.idempotencyKey,
      op: { op: 'shells.launch', shellId, command: input.command, cwd: '/w' },
      signal: args.signal,
      dispatchedBootId: scopeDispatchedBootId(),
    })
    if (result.status !== 'ok') return { ok: false, reason: result.error.message }
    return {
      ok: true,
      output: {
        command: input.command,
        description: input.description,
        shellId,
        backgrounded: true,
        pid: 1,
      },
      modelText: `Started in the background as shell ${shellId}.`,
    }
  }
}

export const makeRuntimeFactory = (args: {
  daemon: InMemoryDaemon
  clock: FakeClock
  script: ScriptRef
  runtimes: RigRuntime[]
  watchedRepos?: (() => Promise<readonly string[]>) | undefined
  watchedCheckouts?: (() => Promise<readonly string[]>) | undefined
  runningShells?: (() => Promise<number>) | undefined
  terminalStreams?: (() => number) | undefined
  panelHolds?: (() => number) | undefined
  prepare?: ((onStep?: PrepareStepReporter) => Promise<PrepareResult>) | undefined
  subscribePrepareOutput?: ((listener: (text: string) => void) => void) | undefined
  subscribeSetup?: ((listener: (lifecycle: SetupLifecycle) => void) => void) | undefined
  model?: (() => ModelPort) | undefined
  hostTools?: readonly ToolDefinition[] | undefined
  baseBranches?: Readonly<Record<string, string>> | undefined
  uploads?: SaidUploadsPort | undefined
  connectGate?: Promise<void> | undefined
  runtimeGate?: Promise<void> | undefined
  beforeRuntime?: (() => Promise<void>) | undefined
  stopGate?: Promise<void> | undefined
  plugins?: ComposedPlugins | undefined
  placeContextFiles?: SessionRuntime['placeContextFiles'] | undefined
}): ((params: {
  sessionId: string
  threadId: ThreadId
  epoch: number
  signal: AbortSignal
}) => Promise<SessionRuntime>) => {
  return async ({ sessionId, epoch }) => {
    await args.beforeRuntime?.()
    await args.runtimeGate
    const model = args.model?.() ?? new ScriptedModel(args.script.current)
    const calls = new RemoteCalls({
      sessionId,
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: async () => {
        await args.connectGate
        return (handlers) => Promise.resolve(args.daemon.connectRaw(handlers))
      },
      timers: args.clock,
      onFenced: () => {},
    })
    calls.open({ epoch })
    const ackedScopes: string[] = []
    const originalAckScope = calls.ackScope.bind(calls)
    calls.ackScope = async ({ scopeKey, count }) => {
      await originalAckScope({ scopeKey, count })
      ackedScopes.push(scopeKey)
    }
    const preparePort = args.prepare ?? (async () => ({ ok: true as const }))
    const gate = new WorkspaceGate()
    const attempt = (onStep?: PrepareStepReporter): Promise<PrepareResult> => {
      const running = preparePort(onStep)
      gate.arm(running)
      return running
    }
    const modelOfCalls: RoleModelChoice[] = []
    const placedContextFiles: SpawnFile[][] = []
    const runtime: RigRuntime = {
      placedContextFiles,
      remoteCalls: calls,
      model,
      classifier: OFF_CLASSIFIER,
      classifierStatus: { on: false, reason: 'the rig has no classifier' },
      modelChoice: RIG_MODEL_CHOICE,
      modelOfCalls,
      modelOf: (choice) => {
        modelOfCalls.push(choice)
        return model
      },
      choiceFor: (request) => request.root ?? RIG_MODEL_CHOICE,
      modelLabelOf: (ref) => refKey(ref),
      tools: fakeToolRegistry([new BashTool(calls, gate), ...(args.hostTools ?? [])]),
      daemonTools: new Set(['bash']),
      ackedScopes,
      effectOf: () => EToolEffect.Read,
      assembly: defaultPipeline({
        prompt: () => EMPTY_PROMPT,
        launchDirectory: '/w',
      }),
      normalizeFailure: ({ message }) => ({
        kind: EProviderFailureKind.Network,
        scope: EProviderFailureScope.Route,
        retry: EProviderRetry.Transient,
        message,
      }),
      ...(args.uploads === undefined ? {} : { uploads: args.uploads }),
      placeContextFiles:
        args.placeContextFiles ??
        (async ({ files }) => {
          const writes = new DaemonFileSystemPort({ calls })
          const placed = await placeContextFiles({
            files,
            directory: CONTEXT_DIRECTORY,
            writes: {
              mkdir: async ({ path }) => {
                await writes.mkdir({ path })
              },
              writeFile: async ({ path, content }) => {
                await writes.writeFile({ path, content })
              },
              readLink: async ({ path }) => await writes.readLink({ path }),
            },
          })
          placedContextFiles.push([...files])
          return placed
        }),
      launchDirectory: '/w',
      watched: [],
      watchedRepos: args.watchedRepos ?? (async () => runtime.watched),
      watchedCheckouts: args.watchedCheckouts ?? args.watchedRepos ?? (async () => runtime.watched),
      baseBranchOf: (repoPath) => args.baseBranches?.[repoPath] ?? null,
      ...(args.plugins === undefined ? {} : { plugins: args.plugins }),
      runningShells: args.runningShells ?? (async () => 0),
      ...(args.terminalStreams === undefined ? {} : { terminalStreams: args.terminalStreams }),
      ...(args.panelHolds === undefined ? {} : { panelHolds: args.panelHolds }),
      workspaceGate: gate,
      prepare: (onStep) => attempt(onStep),
      ...(args.subscribePrepareOutput === undefined
        ? {}
        : { subscribePrepareOutput: args.subscribePrepareOutput }),
      ...(args.subscribeSetup === undefined ? {} : { subscribeSetup: args.subscribeSetup }),
      stopped: false,
      released: false,
      stop: async () => {
        await args.stopGate
        runtime.stopped = true
        calls.close()
      },
      release: async () => {
        runtime.released = true
        calls.close()
      },
    }
    args.runtimes.push(runtime)
    return runtime
  }
}
