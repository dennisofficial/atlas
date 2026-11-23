import { defaultPipeline, type ModelPort } from '@dltech/atlas-core'
import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import { classifierOf, classifierStatusOf } from '@dltech/atlas-classifier'
import {
  DaemonAgentFileSystemPort,
  DaemonFileSystemPort,
  DaemonProcessPort,
  contextFilesPlacerOf,
  type HostTimers,
  type SessionRuntimeFactory,
} from '@dltech/atlas-host'
import {
  logFieldsOf,
  type LogPort,
  type ProductAnalytics,
  type TracePort,
} from '@dltech/atlas-observability'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { MediaSigner } from '../media/media-signer'
import { attachmentUrlBinding } from '../media/media-urls'
import { normalizeProviderFailure } from '../model/failure'
import type { ModelTokenService } from '../tokens/model-token-service'
import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { SigningKeyReader } from '../tokens/signing-key-reader'
import { SandboxSaidUploads } from '../uploads/sandbox-said-uploads'
import { signerUploadBlobs } from '../uploads/upload-blobs'
import type { ConfigSource } from '../config/agent-host-config'
import type { CloudConfigStore } from '../config/cloud-config-store'
import type { EnvSecretsSource } from '../config/env-secrets'
import type { ProjectFilesSource } from '../config/project-files'
import { SANDBOX_HOME_PATH, workspaceDirectoryOf } from '@dltech/atlas-pods/sandbox/constants'
import type { SandboxProviderRegistry } from '@dltech/atlas-pods/sandbox/provider-registry'
import type { DaemonEndpoint, SandboxTarget } from '@dltech/atlas-pods/sandbox/sandbox-provider'
import { recordSandboxRunOpen } from '@dltech/atlas-pods/sandbox/sandbox-runs'
import { sandboxNameOf } from '@dltech/atlas-pods/sandbox/vercel-names'
import { SandboxNotConfiguredError } from '@dltech/atlas-pods/runtime/sandbox-not-configured-error'
import { PrepareSteps } from './prepare-steps'
import { prepareControllerOf } from './session-prepare'
import { countRunningShells } from './running-shells'
import { startKeepAlive } from './keep-alive'
import { daemonSessionOf } from './daemon-session'
import { githubIdentityLookup } from '@dltech/atlas-plugin-github/pod'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
import { agentHostPrompt } from './prompt'
import { EnvSecretsFragment } from './prompt-fragments/secrets'
import { watchWorkspaceRepos } from './git-watch'
import { TaskWriteTool } from '../agent-tools/task-write'
import { configToolsOf } from './config-tools'
import { daemonToolsOf } from './tools'
import { DaemonShellLauncher } from './daemon-shell-launcher'
import { ShellEnvCell } from './shell-env'
import { envSecretsRefresher } from './env-secrets-refresh'
import { githubTokenRefresher } from './github-token-refresh'
import { pathEnvironmentOf, sessionPathsOf, shellEnvironmentOf } from './session-paths'
import { fastRefusalHandler, type FastRefusalSessions } from './fast-refusal'
import { sessionModelsOf, type SessionModels } from './model-port'
import { modelLabelOf } from '../config/model-labels'
import { podAnalyticsOf } from './pod-analytics'
import { workspaceRepoMap } from './workspace-repo-map'

export { SandboxNotConfiguredError }

export type SessionRuntimeFactoryArgs = {
  config: ConfigSource
  tokens: Pick<ModelTokenService, 'issue'>
  github: Pick<GithubTokenReader, 'read'>
  signingKey?: Pick<SigningKeyReader, 'read'> | undefined
  sandbox: SandboxProviderRegistry
  daemonSecret: string
  timers: HostTimers
  modelFor?: ((args: { sessionId: string }) => ModelPort) | undefined
  launchDirectory?: string | undefined
  sandboxHome?: string | undefined
  setupDeadlineMs?: number | undefined
  log?: LogPort | undefined
  traceFor?: ((distinctId: string) => TracePort) | undefined
  analytics?: ProductAnalytics | undefined
  pingMs?: number | undefined
  media?: MediaSigner | undefined
  githubFetch?: typeof fetch | undefined
  plugins?: ComposedPlugins | undefined
  configWrites?: CloudConfigStore | undefined
  envSecrets?: EnvSecretsSource | undefined
  projectFiles?: ProjectFilesSource | undefined
  terminalStreams?: ((sessionId: string) => number) | undefined
  panelHolds?: ((sessionId: string) => number) | undefined
  sessions?: FastRefusalSessions | undefined
  podSizing?:
    | {
        recordPodApplied(args: {
          sessionId: string
          vcpus: number
          memoryGb: number
          generation: number
        }): Promise<boolean>
        recordPodDisk(args: { sessionId: string; diskGb: number }): Promise<boolean>
        readSession(args: { sessionId: string }): Promise<
          | {
              podDesiredVcpus: number | null
              podDesiredMemoryGb: number | null
              podDesiredDiskGb: number | null
              podSizeGeneration: number
            }
          | undefined
        >
      }
    | undefined
}

export const createSessionRuntimeFactory = (
  args: SessionRuntimeFactoryArgs,
): SessionRuntimeFactory => {
  return async ({
    sessionId,
    podSessionId: sandboxSessionId,
    threadId,
    epoch,
    signal,
    spawner,
  }) => {
    const config = await args.config.read({ sessionId })
    const launchDirectory =
      args.launchDirectory ?? workspaceDirectoryOf({ remoteUrl: config.workspace.remoteUrl })
    const provider = args.sandbox.for(config.sandbox.provider)
    if (config.sandbox.configured === false) {
      throw new SandboxNotConfiguredError(config.sandbox.gap)
    }
    const target: SandboxTarget = {
      sandboxSessionId,
      credentials: config.sandbox.credentials,
    }
    const sandboxName = sandboxNameOf(sandboxSessionId)
    const paths = sessionPathsOf({ sessionId, threadId, home: args.sandboxHome })
    const podSize = config.podSize
    const desiredVcpus = podSize?.desiredVcpus ?? config.sandbox.vcpus
    const desiredDiskGb = config.sandbox.diskGb
    // A resize writes its desired size and generation on the pod row while this runtime is still
    // the one waking its sandbox, so the size is read at wake time: the snapshot taken when the
    // runtime was built predates the resize, and a pod never resized has no snapshot at all.
    const recordApplied = async (endpoint: DaemonEndpoint): Promise<void> => {
      const { vcpus, memoryGb } = endpoint
      if (args.podSizing === undefined || vcpus === undefined || memoryGb === undefined) return
      try {
        const pod = await args.podSizing.readSession({ sessionId: sandboxSessionId })
        if (pod === undefined || pod === null) return
        const neverResized = pod.podDesiredVcpus === null
        const diskReached =
          pod.podDesiredDiskGb === null ||
          (endpoint.diskGb !== undefined && endpoint.diskGb >= pod.podDesiredDiskGb)
        const reachedDesired =
          pod.podDesiredVcpus === vcpus && pod.podDesiredMemoryGb === memoryGb && diskReached
        if (!neverResized && !reachedDesired) return
        await args.podSizing.recordPodApplied({
          sessionId: sandboxSessionId,
          vcpus,
          memoryGb,
          generation: pod.podSizeGeneration,
        })
      } catch (error) {
        args.log?.warn({
          source: 'runtime.wake',
          message: `recording the applied pod size for ${sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      }
    }
    const recordDisk = async (endpoint: DaemonEndpoint): Promise<void> => {
      if (args.podSizing === undefined) return
      const diskGb =
        endpoint.diskGb ??
        (config.sandbox.provider === ESandboxProvider.Agent37 ? desiredDiskGb : undefined)
      if (diskGb === undefined) return
      try {
        const pod = await args.podSizing.readSession({ sessionId: sandboxSessionId })
        if (pod === undefined || pod === null || pod.podDesiredDiskGb !== null) return
        await args.podSizing.recordPodDisk({ sessionId: sandboxSessionId, diskGb })
      } catch (error) {
        args.log?.warn({
          source: 'runtime.wake',
          message: `recording the pod disk for ${sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      }
    }
    const recordRun = async (endpoint: DaemonEndpoint): Promise<void> => {
      const vcpus = endpoint.vcpus ?? desiredVcpus
      if (vcpus === undefined) return
      await recordSandboxRunOpen({
        sessionId: sandboxSessionId,
        provider: config.sandbox.provider,
        vcpus,
        sandbox: provider,
        target,
        ...(endpoint.diskGb === undefined ? {} : { diskGb: endpoint.diskGb }),
      })
    }
    const onWake = async (endpoint: DaemonEndpoint): Promise<void> => {
      await recordDisk(endpoint)
      await recordApplied(endpoint)
      await recordRun(endpoint)
    }
    const steps = new PrepareSteps()
    const { calls } = daemonSessionOf({
      sessionId,
      epoch,
      provider,
      target,
      ...(desiredVcpus === undefined ? {} : { vcpus: desiredVcpus }),
      ...(desiredDiskGb === undefined ? {} : { diskGb: desiredDiskGb }),
      onWake,
      daemonSecret: args.daemonSecret,
      timers: args.timers,
      signal,
      steps,
      ...(args.log === undefined ? {} : { log: args.log }),
      ...(args.pingMs === undefined ? {} : { pingMs: args.pingMs }),
    })

    const processes = new DaemonProcessPort({ calls })
    const files = new DaemonFileSystemPort({ calls })
    const agentFiles = new DaemonAgentFileSystemPort({ calls })
    const shellEnv = new ShellEnvCell({
      identityOf: githubIdentityLookup({ fetch: args.githubFetch }),
      log: args.log,
    })
    const refreshSecrets = envSecretsRefresher({
      source: args.envSecrets,
      cell: shellEnv,
      userId: config.userId,
      projectId: config.projectId,
      sessionId,
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    const refreshGithubToken = githubTokenRefresher({
      reader: args.github,
      cell: shellEnv,
      userId: config.userId,
      sessionId,
      launchDirectory,
      log: args.log,
    })
    const prepareController = prepareControllerOf({
      sessionId,
      userId: config.userId,
      launchDirectory,
      sandboxName,
      workspace: config.workspace,
      paths,
      calls,
      processes,
      files,
      steps,
      shellEnv,
      refreshSecrets,
      projectFiles: args.projectFiles,
      projectId: config.projectId,
      github: args.github,
      signingKey: args.signingKey,
      timers: args.timers,
      setupDeadlineMs: args.setupDeadlineMs,
      log: args.log,
    })
    const gate = prepareController.gate
    const gitWatch = watchWorkspaceRepos({
      calls,
      gate,
      launchDirectory,
      additionalRepos: config.workspace.additionalRepos,
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    const repoMap = workspaceRepoMap({
      launchDirectory,
      workspace: config.workspace,
    })
    const repoAt = (path: string) => repoMap.find((entry) => entry.path === path)
    const sessionShellEnv = async (): Promise<Record<string, string>> => {
      await Promise.all([refreshSecrets(), refreshGithubToken()])
      return shellEnvironmentOf({ paths, base: shellEnv.current() })
    }
    const daemonToolList = daemonToolsOf({
      processes,
      files,
      agentFiles,
      pathEnv: pathEnvironmentOf(paths),
      gate: prepareController.workspaceGate,
      launcher: new DaemonShellLauncher({ calls }),
      shellEnv: sessionShellEnv,
    })
    const tools = [
      ...daemonToolList,
      new TaskWriteTool(),
      ...configToolsOf({ store: args.configWrites, projectId: config.projectId }),
    ]
    const registry = new InMemoryToolRegistry(tools)
    const byName = new Map(tools.map((tool) => [tool.name, tool]))

    const onFastRefused =
      args.sessions === undefined
        ? undefined
        : fastRefusalHandler({
            sessions: args.sessions,
            sessionId,
            choice: () => models.modelChoice(),
            log: args.log,
          })

    const trace = args.traceFor?.(config.userId)
    const analytics = podAnalyticsOf({
      analytics: args.analytics,
      userId: config.userId,
    })
    let models: SessionModels
    try {
      models = sessionModelsOf({
        override: args.modelFor,
        sessionId,
        userId: config.userId,
        initial: config.models,
        read: () => args.config.models({ sessionId }),
        tokens: args.tokens,
        media: args.media,
        log: args.log,
        ...(trace === undefined ? {} : { trace }),
        onFastRefused,
      })
    } catch (error) {
      calls.close()
      throw error
    }

    const classifier = classifierOf(config.classifier)
    const classifierStatus = classifierStatusOf(config.classifier)

    const keepAlive = startKeepAlive({
      sandbox: provider,
      target,
      timers: args.timers,
      signal,
      log: args.log,
    })

    return {
      remoteCalls: calls,
      workspaceGate: prepareController.workspaceGate,
      ...(trace === undefined ? {} : { trace }),
      ...(args.terminalStreams === undefined
        ? {}
        : { terminalStreams: () => args.terminalStreams?.(sessionId) ?? 0 }),
      ...(args.panelHolds === undefined
        ? {}
        : { panelHolds: () => args.panelHolds?.(sessionId) ?? 0 }),
      model: models.main,
      classifier,
      classifierStatus,
      ...(analytics === undefined ? {} : { analytics }),
      get modelChoice() {
        return models.modelChoice()
      },
      modelOf: models.modelOf,
      choiceFor: models.choiceFor,
      modelLabelOf,
      tools: registry,
      daemonTools: new Set(daemonToolList.map((tool) => tool.name)),
      effectOf: (name) => byName.get(name)?.effect,
      assembly: defaultPipeline({
        prompt: agentHostPrompt({
          identity: () => models.main.identity,
          extraFragments: [
            ...(args.plugins?.pod.prompts ?? []),
            new EnvSecretsFragment(() => shellEnv.exportedSecretNames()),
          ],
          spawner,
        }),
        launchDirectory,
      }),
      uploads: new SandboxSaidUploads({
        userId: config.userId,
        home: args.sandboxHome ?? SANDBOX_HOME_PATH,
        files,
        blobs: args.media === undefined ? null : signerUploadBlobs(args.media),
      }),
      ...attachmentUrlBinding({ signer: args.media, userId: config.userId }),
      normalizeFailure: normalizeProviderFailure,
      launchDirectory,
      watchedRepos: () => gitWatch.watchedRepos(),
      onRepo: (listener) => gitWatch.onRepo(listener),
      watchedCheckouts: () => gitWatch.watchedCheckouts(),
      onCheckout: (listener) => gitWatch.onCheckout(listener),
      baseBranchOf: (repoPath) =>
        repoAt(repoPath)?.base ?? prepareController.checkedOutBaseOf(repoPath),
      plugins: args.plugins,
      runningShells: () => countRunningShells({ calls }),
      env: sessionShellEnv,
      placeContextFiles: contextFilesPlacerOf({ directory: paths.contextDir, port: files }),
      prepare: prepareController.prepare,
      subscribePrepareOutput: (listener) => steps.subscribeOutput(listener),
      // the setup script may start, or finish, before a replacement host subscribes: replay it
      subscribeSetup: prepareController.subscribeSetup,
      stop: async () => {
        keepAlive.stop()
        calls.close('detached')
      },
      release: async () => {
        await keepAlive.release()
        calls.close('detached')
      },
    }
  }
}
