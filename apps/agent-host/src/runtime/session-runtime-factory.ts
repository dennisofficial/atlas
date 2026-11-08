import {
  DEFAULT_EFFORT,
  defaultPipeline,
  findCard,
  toAccountId,
  type ModelRef,
  EWorkspaceStep,
  EWorkspaceStepState,
  type ModelPort,
} from '@dltech/atlas-core'
import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import {
  DaemonAgentFileSystemPort,
  DaemonFileSystemPort,
  DaemonProcessPort,
  RemoteCalls,
  type HostTimers,
  type PrepareResult,
  type PrepareStepReporter,
  type SessionRuntimeFactory,
} from '@dltech/atlas-host'
import { generatedCatalogue } from '@dltech/atlas-models'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { MediaSigner } from '../media/media-signer'
import { signerUrls } from '../media/media-urls'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { createProviderModel } from '../model/providers'
import { normalizeProviderFailure } from '../model/failure'
import type { ModelTokenService } from '../tokens/model-token-service'
import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { SigningKeyReader } from '../tokens/signing-key-reader'
import { SandboxSaidUploads } from '../uploads/sandbox-said-uploads'
import { signerUploadBlobs } from '../uploads/upload-blobs'
import type { ConfigSource } from '../config/agent-host-config'
import { AgentHostCredentialPort } from '../config/agent-host-credential-port'
import { SANDBOX_HOME_PATH, WORKSPACE_PATH } from '../sandbox/constants'
import { SandboxProvider, sandboxNameOf, type DaemonEndpoint } from '../sandbox/sandbox-provider'
import { abortable } from './abortable'
import { SandboxNotConfiguredError } from './sandbox-not-configured-error'
import { PrepareSteps } from './prepare-steps'
import { countRunningShells } from './running-shells'
import { startKeepAlive } from './keep-alive'
import { rewakingConnector } from './rewaking-connector'
import { GithubPullRequestFinder, githubIdentityLookup } from '@dltech/atlas-plugin-github/pod'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
import { agentHostPrompt } from './prompt'
import { watchWorkspaceRepos } from './git-watch'
import { daemonToolsOf } from './tools'
import { ShellEnvCell } from './shell-env'
import { prepareSigning } from './signing-setup'
import { ensureWorkspace } from './workspace-setup'
import { workspaceRepoMap } from './workspace-repo-map'

export { SandboxNotConfiguredError }

const SETUP_DEADLINE_MS = 15 * 60_000

export type SessionRuntimeFactoryArgs = {
  config: ConfigSource
  tokens: Pick<ModelTokenService, 'issue'>
  github: Pick<GithubTokenReader, 'read'>
  signingKey?: Pick<SigningKeyReader, 'read'> | undefined
  sandbox: SandboxProvider
  daemonSecret: string
  timers: HostTimers
  modelFor?: ((args: { sessionId: string }) => ModelPort) | undefined
  launchDirectory?: string | undefined
  setupDeadlineMs?: number | undefined
  log?: LogPort | undefined
  pingMs?: number | undefined
  media?: MediaSigner | undefined
  githubFetch?: typeof fetch | undefined
  plugins?: ComposedPlugins | undefined
}

const UNCONFIGURED_REF: ModelRef = { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }

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
    const steps = new PrepareSteps()
    steps.report({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started })
    const endpoint = wake()
    endpoint.then(
      () => steps.report({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done }),
      (error: unknown) => steps.failOpen(error instanceof Error ? error.message : String(error)),
    )
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
    const shellEnv = new ShellEnvCell({
      identityOf: githubIdentityLookup({ fetch: args.githubFetch }),
      log: args.log,
    })
    const attempt = (signal: AbortSignal): Promise<PrepareResult> =>
      abortable(calls.ready(), signal)
        .then(async () => {
          steps.report({ step: EWorkspaceStep.Daemon, state: EWorkspaceStepState.Done })
          const token = await abortable(args.github.read({ userId: config.userId }), signal)
          const signing = await prepareSigning({
            reader: args.signingKey,
            files,
            userId: config.userId,
            launchDirectory,
            signal,
            log: args.log,
          })
          await shellEnv.refresh({ token, signing, launchDirectory, signal })
          return ensureWorkspace({
            calls,
            processes,
            files,
            workspace: config.workspace,
            githubToken: token,
            launchDirectory,
            sandboxName: sandboxNameOf(sessionId),
            signal,
            onStep: (step) => steps.report(step),
            onOutput: (text) => steps.output(text),
            ...(args.log === undefined ? {} : { log: args.log }),
          })
        })
        .catch((error: unknown): PrepareResult => {
          steps.failOpen(error instanceof Error ? error.message : String(error))
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
          steps.failOpen(`workspace setup did not finish within ${deadlineMs}ms`)
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
    const prepare = (onStep?: PrepareStepReporter): Promise<PrepareResult> => {
      if (onStep !== undefined) steps.subscribe(onStep)
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
    const repoMap = workspaceRepoMap({ launchDirectory, workspace: config.workspace })
    const repoAt = (path: string) => repoMap.find((entry) => entry.path === path)
    const tools = daemonToolsOf({
      processes,
      files,
      agentFiles,
      setup: gate,
      shellEnv: () => shellEnv.current(),
    })
    const registry = new InMemoryToolRegistry(tools)
    const byName = new Map(tools.map((tool) => [tool.name, tool]))

    let model: ModelPort
    const chosen = config.model.configured === true ? config.model : undefined
    const ref = chosen?.ref ?? UNCONFIGURED_REF
    try {
      model =
        args.modelFor === undefined
          ? new AiSdkModelPort({
              model: createProviderModel({
                ref,
                credentials: new AgentHostCredentialPort({
                  userId: config.userId,
                  model: config.model,
                  tokens: args.tokens,
                }),
                ...(chosen === undefined ? {} : { accountId: toAccountId(chosen.accountId) }),
                effort: () => chosen?.effort ?? DEFAULT_EFFORT,
                fast: () => chosen?.fast ?? false,
              }),
              card: () => findCard({ catalog: generatedCatalogue(), ref }),
              mediaUrls:
                args.media === undefined
                  ? undefined
                  : signerUrls({ signer: args.media, userId: config.userId }),
            })
          : args.modelFor({ sessionId })
    } catch (error) {
      calls.close()
      throw error
    }

    const stopKeepAlive = startKeepAlive({
      sandbox: args.sandbox,
      sessionId,
      credentials,
      timers: args.timers,
      signal,
      log: args.log,
    })

    return {
      remoteCalls: calls,
      model,
      tools: registry,
      daemonTools: new Set(byName.keys()),
      effectOf: (name) => byName.get(name)?.effect,
      assembly: defaultPipeline({
        prompt: agentHostPrompt({
          identity: model.identity,
          extraFragments: args.plugins?.pod.prompts,
        }),
        launchDirectory,
      }),
      uploads: new SandboxSaidUploads({
        userId: config.userId,
        home: SANDBOX_HOME_PATH,
        files,
        blobs: args.media === undefined ? null : signerUploadBlobs(args.media),
      }),
      normalizeFailure: normalizeProviderFailure,
      launchDirectory,
      watchedRepos: () => gitWatch.watchedRepos(),
      baseBranchOf: (repoPath) => repoAt(repoPath)?.base ?? null,
      pullRequests: {
        repoOf: (repoPath) => repoAt(repoPath)?.repo ?? null,
        finder: new GithubPullRequestFinder({ userId: config.userId, github: args.github }),
      },
      plugins: args.plugins,
      runningShells: () => countRunningShells({ calls }),
      prepare,
      subscribePrepareOutput: (listener) => steps.subscribeOutput(listener),
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
