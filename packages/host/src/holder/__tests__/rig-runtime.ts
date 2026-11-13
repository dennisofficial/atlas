import {
  defaultPipeline,
  EEffort,
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  ToolDefinition,
  type ModelPort,
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
import { scopeDispatchedBootId } from '../../calls/call-scope'
import type {
  PrepareResult,
  PrepareStepReporter,
  PullRequestSource,
  RoleModelRequest,
  SessionRuntime,
} from '../ports'
import { SANDBOX, SECRET, type FakeClock } from './rig-fakes'

export const RIG_MODEL_CHOICE = {
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.Medium,
  fast: false,
}

export type RigRuntime = SessionRuntime & {
  model: ModelPort
  modelForCalls: RoleModelRequest[]
  stopped: boolean
  released: boolean
  ackedScopes: string[]
  watched: string[]
}

export type ScriptRef = { current: readonly ScriptedModelStep[] }

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
}

const bashCommandOf = (input: unknown): string => {
  if (typeof input === 'object' && input !== null && 'command' in input) {
    return String((input as { command: unknown }).command)
  }
  return 'true'
}

export const makeRuntimeFactory = (args: {
  daemon: InMemoryDaemon
  clock: FakeClock
  script: ScriptRef
  runtimes: RigRuntime[]
  watchedRepos?: (() => Promise<readonly string[]>) | undefined
  runningShells?: (() => Promise<number>) | undefined
  prepare?: ((onStep?: PrepareStepReporter) => Promise<PrepareResult>) | undefined
  subscribePrepareOutput?: ((listener: (text: string) => void) => void) | undefined
  model?: (() => ModelPort) | undefined
  baseBranches?: Readonly<Record<string, string>> | undefined
  pullRequests?: PullRequestSource | undefined
  uploads?: SaidUploadsPort | undefined
  connectGate?: Promise<void> | undefined
  runtimeGate?: Promise<void> | undefined
  beforeRuntime?: (() => Promise<void>) | undefined
  plugins?: ComposedPlugins | undefined
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
    const modelForCalls: RoleModelRequest[] = []
    const runtime: RigRuntime = {
      remoteCalls: calls,
      model,
      modelChoice: RIG_MODEL_CHOICE,
      modelForCalls,
      modelFor: (request) => {
        modelForCalls.push(request)
        return model
      },
      choiceFor: () => RIG_MODEL_CHOICE,
      tools: fakeToolRegistry([new BashTool(calls)]),
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
      launchDirectory: '/w',
      watched: [],
      watchedRepos: args.watchedRepos ?? (async () => runtime.watched),
      baseBranchOf: (repoPath) => args.baseBranches?.[repoPath] ?? null,
      ...(args.pullRequests === undefined ? {} : { pullRequests: args.pullRequests }),
      ...(args.plugins === undefined ? {} : { plugins: args.plugins }),
      runningShells: args.runningShells ?? (async () => 0),
      prepare: (onStep) => (args.prepare ?? (async () => ({ ok: true as const })))(onStep),
      ...(args.subscribePrepareOutput === undefined
        ? {}
        : { subscribePrepareOutput: args.subscribePrepareOutput }),
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
    args.runtimes.push(runtime)
    return runtime
  }
}
