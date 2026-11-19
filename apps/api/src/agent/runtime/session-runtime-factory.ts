import { defaultPipeline, type ModelPort } from '@dltech/atlas-core'
import { InMemoryToolRegistry } from '@dltech/atlas-agent'
import {
  DaemonAgentFileSystemPort,
  DaemonFileSystemPort,
  DaemonProcessPort,
  type HostTimers,
  type SessionRuntimeFactory,
} from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

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
import { SANDBOX_HOME_PATH, workspaceDirectoryOf } from '../sandbox/constants'
import type { SandboxProviderRegistry } from '../sandbox/provider-registry'
import type { SandboxTarget } from '../sandbox/sandbox-provider'
import { sandboxNameOf } from '../sandbox/vercel-names'
import { SandboxNotConfiguredError } from './sandbox-not-configured-error'
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
import { ShellEnvCell } from './shell-env'
import { envSecretsRefresher } from './env-secrets-refresh'
import { githubTokenRefresher } from './github-token-refresh'
import { pathEnvironmentOf, sessionPathsOf, shellEnvironmentOf } from './session-paths'
import { sessionModelsOf, type SessionModels } from './model-port'
import { modelLabelOf } from '../config/model-labels'
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
  setupDeadlineMs?: number | undefined
  log?: LogPort | undefined
  pingMs?: number | undefined
  media?: MediaSigner | undefined
  githubFetch?: typeof fetch | undefined
  plugins?: ComposedPlugins | undefined
  configWrites?: CloudConfigStore | undefined
  envSecrets?: EnvSecretsSource | undefined
  projectFiles?: ProjectFilesSource | undefined
  terminalStreams?: ((sessionId: string) => number) | undefined
  podSizing?:
    | {
        recordPodApplied(args: {
          sessionId: string
          vcpus: number
          generation: number
        }): Promise<boolean>
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
    const paths = sessionPathsOf({ sessionId, threadId })
    const podSize = config.podSize
    const desiredVcpus = podSize?.desiredVcpus ?? config.sandbox.vcpus
    const recordApplied = async (endpoint: { vcpus?: number | undefined }): Promise<void> => {
      if (args.podSizing === undefined || podSize?.desiredVcpus === undefined) return
      if (endpoint.vcpus !== podSize.desiredVcpus) return
      try {
        await args.podSizing.recordPodApplied({
          sessionId,
          vcpus: endpoint.vcpus,
          generation: podSize.generation,
        })
      } catch (error) {
        args.log?.warn({
          source: 'runtime.wake',
          message: `recording the applied pod size for ${sessionId} failed`,
          ...logFieldsOf({ error }),
        })
      }
    }
    const steps = new PrepareSteps()
    const { calls } = daemonSessionOf({
      sessionId,
      epoch,
      provider,
      target,
      ...(desiredVcpus === undefined ? {} : { vcpus: desiredVcpus }),
      onWake: recordApplied,
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
      setup: gate,
      shellEnv: sessionShellEnv,
    })
    const tools = [
      ...daemonToolList,
      new TaskWriteTool(),
      ...configToolsOf({ store: args.configWrites, projectId: config.projectId }),
    ]
    const registry = new InMemoryToolRegistry(tools)
    const byName = new Map(tools.map((tool) => [tool.name, tool]))

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
      })
    } catch (error) {
      calls.close()
      throw error
    }

    const keepAlive = startKeepAlive({
      sandbox: provider,
      target,
      timers: args.timers,
      signal,
      log: args.log,
    })

    return {
      remoteCalls: calls,
      ...(args.terminalStreams === undefined
        ? {}
        : { terminalStreams: () => args.terminalStreams?.(sessionId) ?? 0 }),
      model: models.main,
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
        home: SANDBOX_HOME_PATH,
        files,
        blobs: args.media === undefined ? null : signerUploadBlobs(args.media),
      }),
      ...attachmentUrlBinding({ signer: args.media, userId: config.userId }),
      normalizeFailure: normalizeProviderFailure,
      launchDirectory,
      watchedRepos: () => gitWatch.watchedRepos(),
      onRepo: (listener) => gitWatch.onRepo(listener),
      baseBranchOf: (repoPath) =>
        repoAt(repoPath)?.base ?? prepareController.checkedOutBaseOf(repoPath),
      plugins: args.plugins,
      runningShells: () => countRunningShells({ calls }),
      env: sessionShellEnv,
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
