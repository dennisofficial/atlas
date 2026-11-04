import { defaultPipeline, type ModelPort } from '@dltech/atlas-core'
import {
  AiSdkModelPort,
  createAnthropicOauthModel,
  normalizeProviderFailure,
} from '@dltech/atlas-harness'
import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import {
  DaemonAgentFileSystemPort,
  DaemonFileSystemPort,
  DaemonProcessPort,
  RemoteCalls,
  SandboxUnavailableError,
  webSocketConnector,
  type HostTimers,
  type SessionRuntimeFactory,
} from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { WORKSPACE_PATH } from '@dltech/atlas-wire'

import type { AgentHostApi } from '../config/agent-host-api'
import { AgentHostCredentialPort } from '../config/agent-host-credential-port'
import { SandboxProvider, sandboxNameOf } from '../sandbox/sandbox-provider'
import { agentHostPrompt } from './prompt'
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
  api: AgentHostApi
  sandbox: SandboxProvider
  daemonSecret: string
  timers: HostTimers
  modelFor?: ((args: { sessionId: string }) => ModelPort) | undefined
  launchDirectory?: string | undefined
  setupDeadlineMs?: number | undefined
  log?: LogPort | undefined
}

const fallbackModelId = 'claude-sonnet-4-5'

export const createSessionRuntimeFactory = (
  args: SessionRuntimeFactoryArgs,
): SessionRuntimeFactory => {
  const launchDirectory = args.launchDirectory ?? WORKSPACE_PATH
  return async ({ sessionId, epoch, signal }) => {
    const config = await args.api.config({ sessionId })
    if (config.vercel.configured === false) {
      throw new SandboxNotConfiguredError(config.vercel.gap)
    }
    const credentials = {
      token: config.vercel.token,
      teamId: config.vercel.teamId,
      projectId: config.vercel.projectId,
    }
    const endpoint = args.sandbox.wake({ sessionId, credentials, signal })
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
      connector: async () => {
        try {
          return webSocketConnector({ url: (await endpoint).url })
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          throw new SandboxUnavailableError(`sandbox wake for ${sessionId} failed: ${reason}`)
        }
      },
      timers: args.timers,
      onFenced: () => {},
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    calls.open({ epoch })
    calls.ready().catch(() => undefined)

    const processes = new DaemonProcessPort({ calls })
    const files = new DaemonFileSystemPort({ calls })
    const agentFiles = new DaemonAgentFileSystemPort({ calls })
    const setup = calls
      .ready()
      .then(async () => {
        const { token } = await args.api.githubToken({ sessionId })
        await ensureWorkspace({
          calls,
          processes,
          files,
          workspace: config.workspace,
          githubToken: token,
          launchDirectory,
          sandboxName: sandboxNameOf(sessionId),
          ...(args.log === undefined ? {} : { log: args.log }),
        })
      })
      .catch((error: unknown) => {
        args.log?.error({
          source: 'runtime.workspace-setup',
          message: `workspace setup for ${sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      })
    const deadlineMs = args.setupDeadlineMs ?? SETUP_DEADLINE_MS
    const gate = Promise.race([
      setup,
      new Promise<void>((resolve) => {
        args.timers.setTimeout(() => {
          args.log?.error({
            source: 'runtime.workspace-setup',
            message: `workspace setup for ${sessionId} did not finish within ${deadlineMs}ms; releasing the tool gate`,
          })
          resolve()
        }, deadlineMs)
      }),
    ])
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
                  sessionId,
                  model: config.model,
                  api: args.api,
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
