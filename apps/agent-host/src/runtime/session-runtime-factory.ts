import { defaultPipeline, type ModelPort } from '@dltech/atlas-core'
import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import {
  DaemonAgentFileSystemPort,
  DaemonFileSystemPort,
  DaemonProcessPort,
  RemoteCalls,
  type HostTimers,
  type PrepareResult,
  type SessionRuntimeFactory,
} from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { createAnthropicOauthModel } from '../model/anthropic-oauth'
import { normalizeProviderFailure } from '../model/failure'
import type { ModelTokenService } from '../tokens/model-token-service'
import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { ConfigSource } from '../config/agent-host-config'
import { AgentHostCredentialPort } from '../config/agent-host-credential-port'
import { WORKSPACE_PATH } from '../sandbox/constants'
import { SandboxProvider, sandboxNameOf, type DaemonEndpoint } from '../sandbox/sandbox-provider'
import { abortable } from './abortable'
import { rewakingConnector } from './rewaking-connector'
import { agentHostPrompt } from './prompt'
import { watchWorkspaceRepos } from './git-watch'
import { daemonToolsOf } from './tools'
import { ensureWorkspace } from './workspace-setup'

export class SandboxNotConfiguredError extends Error {
  constructor(public readonly gap: string) {
    super(`sandbox is not configured: ${gap}`)
    this.name = 'SandboxNotConfiguredError'
  }
}

const KEEP_ALIVE_EVERY_MS = 10 * 60_000
const KEEP_ALIVE_WINDOW_MS = 45 * 60_000
const SETUP_DEADLINE_MS = 15 * 60_000

export type SessionRuntimeFactoryArgs = {
  config: ConfigSource
  tokens: Pick<ModelTokenService, 'issue'>
  github: Pick<GithubTokenReader, 'read'>
  sandbox: SandboxProvider
  daemonSecret: string
  timers: HostTimers
  modelFor?: ((args: { sessionId: string }) => ModelPort) | undefined
  launchDirectory?: string | undefined
  setupDeadlineMs?: number | undefined
  log?: LogPort | undefined
  pingMs?: number | undefined
}

const fallbackModelId = 'claude-sonnet-4-5'

export const createSessionRuntimeFactory = (
  args: SessionRuntimeFactoryArgs,
): SessionRuntimeFactory => {
  const launchDirectory = args.launchDirectory ?? WORKSPACE_PATH
  return async ({ sessionId, epoch, signal }) => {
    const config = await args.config.read({ sessionId })
    if (config.vercel.configured === false) {
      throw new SandboxNotConfiguredError(config.vercel.gap)
    }
    const credentials = {
      token: config.vercel.token,
      teamId: config.vercel.teamId,
      projectId: config.vercel.projectId,
    }
    const wake = (): Promise<DaemonEndpoint> =>
      args.sandbox.wake({ sessionId, credentials, signal })
    const endpoint = wake()
    endpoint.catch((error: unknown) => {
      args.log?.error({
        source: 'runtime.wake',
        message: `sandbox wake for ${sessionId} rejected`,
        ...logFieldsOf({ error }),
      })
    })
    const calls = new RemoteCalls({
      sessionId,
      token: daemonToken({ secret: args.daemonSecret, sandboxName: sandboxNameOf(sessionId) }),
      connector: rewakingConnector({ sessionId, first: endpoint, wake, signal }),
      timers: args.timers,
      onFenced: () => {},
      ...(args.pingMs === undefined ? {} : { pingMs: args.pingMs }),
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    calls.open({ epoch })
    calls.ready().catch(() => undefined)

    const processes = new DaemonProcessPort({ calls })
    const files = new DaemonFileSystemPort({ calls })
    const agentFiles = new DaemonAgentFileSystemPort({ calls })
    const attempt = (signal: AbortSignal): Promise<PrepareResult> =>
      abortable(calls.ready(), signal)
        .then(async () => {
          const token = await abortable(args.github.read({ userId: config.userId }), signal)
          return ensureWorkspace({
            calls,
            processes,
            files,
            workspace: config.workspace,
            githubToken: token,
            launchDirectory,
            sandboxName: sandboxNameOf(sessionId),
            signal,
            ...(args.log === undefined ? {} : { log: args.log }),
          })
        })
        .catch((error: unknown): PrepareResult => {
          args.log?.error({
            source: 'runtime.workspace-setup',
            message: `workspace setup for ${sessionId} failed`,
            ...logFieldsOf({ error }),
          })
          return { ok: false, reason: error instanceof Error ? error.message : String(error) }
        })
    const deadlineMs = args.setupDeadlineMs ?? SETUP_DEADLINE_MS
    let failedAttempt: Promise<PrepareResult> | undefined
    const start = (previous: Promise<unknown>): Promise<PrepareResult> => {
      const controller = new AbortController()
      const running = previous.then(() => attempt(controller.signal))
      let deadline: unknown
      const expired = new Promise<PrepareResult>((resolve) => {
        deadline = args.timers.setTimeout(() => {
          args.log?.error({
            source: 'runtime.workspace-setup',
            message: `workspace setup for ${sessionId} did not finish within ${deadlineMs}ms`,
          })
          controller.abort(new Error(`workspace setup did not finish within ${deadlineMs}ms`))
          resolve({ ok: false, reason: `workspace setup did not finish within ${deadlineMs}ms` })
        }, deadlineMs)
      })
      return Promise.race([running, expired]).then((outcome) => {
        args.timers.clearTimeout(deadline)
        if (!outcome.ok) failedAttempt = running
        return outcome
      })
    }
    let current = start(Promise.resolve())
    const prepare = (): Promise<PrepareResult> => {
      const previous = failedAttempt
      if (previous === undefined) return current
      failedAttempt = undefined
      current = start(previous)
      return current
    }
    const gate = current.then(() => undefined)
    const gitWatch = watchWorkspaceRepos({
      calls,
      gate,
      launchDirectory,
      additionalRepos: config.workspace.additionalRepos,
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    const tools = daemonToolsOf({ processes, files, agentFiles, setup: gate })
    const registry = new InMemoryToolRegistry(tools)
    const byName = new Map(tools.map((tool) => [tool.name, tool]))

    let model: ModelPort
    try {
      model =
        args.modelFor === undefined
          ? new AiSdkModelPort({
              model: createAnthropicOauthModel({
                credentials: new AgentHostCredentialPort({
                  userId: config.userId,
                  model: config.model,
                  tokens: args.tokens,
                }),
                modelId: config.model.configured === true ? config.model.modelId : fallbackModelId,
              }),
            })
          : args.modelFor({ sessionId })
    } catch (error) {
      calls.close()
      throw error
    }

    let keepAlive = signal.aborted
      ? undefined
      : args.timers.setTimeout(function renew() {
          args.sandbox
            .keepAlive({ sessionId, credentials, until: args.timers.now() + KEEP_ALIVE_WINDOW_MS })
            .catch((error: unknown) => {
              args.log?.error({
                source: 'runtime.keep-alive',
                message: `keep-alive for ${sessionId} failed`,
                ...logFieldsOf({ error }),
              })
            })
          keepAlive = args.timers.setTimeout(renew, KEEP_ALIVE_EVERY_MS)
        }, KEEP_ALIVE_EVERY_MS)
    const stopKeepAlive = (): void => {
      args.timers.clearTimeout(keepAlive)
      signal.removeEventListener('abort', stopKeepAlive)
    }
    signal.addEventListener('abort', stopKeepAlive, { once: true })

    return {
      remoteCalls: calls,
      model,
      tools: registry,
      daemonTools: new Set(byName.keys()),
      effectOf: (name) => byName.get(name)?.effect,
      assembly: defaultPipeline({
        prompt: agentHostPrompt({ identity: model.identity }),
        launchDirectory,
      }),
      normalizeFailure: normalizeProviderFailure,
      launchDirectory,
      watchedRepos: () => gitWatch.watchedRepos(),
      prepare,
      stop: async () => {
        stopKeepAlive()
        calls.close()
      },
      release: async () => {
        stopKeepAlive()
        calls.close()
        await args.sandbox.stop({ sessionId, credentials })
      },
    }
  }
}
