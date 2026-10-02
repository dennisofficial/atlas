import {
  AfterToolHook,
  AgentFileSystemPort,
  BeforeToolHook,
  DEFAULT_CONTAINER_IDLE_MINUTES,
  ENoticeTone,
  EServiceStatus,
  ESettingId,
  EShellStatus,
  ExecutionLocationSinkPort,
  FileSystemPort,
  NOTICE_WARN_MS,
  ProcessPort,
  rangeValueOf,
  type NoticePort,
  type ThreadId,
} from '@dltech/atlas-core'

import { registerDisposable } from '../container/disposal'
import { portToken, type DependencyContainer } from '../container/injection'
import { DockerFileSystemPort } from '../execution/docker/docker-filesystem'
import { DockerProcessPort } from '../execution/docker/docker-process'
import type { DockerEngine } from '../execution/docker/engine'
import { sandboxConfigFromHost } from '../execution/docker/host-environment'
import {
  BashActivityHook,
  ReclaimWorktreeSandboxHook,
  startIdleStop,
  stopSandbox,
} from '../execution/docker/lifecycle'
import { ESandboxState } from '../execution/docker/status'
import { LocalProcessPort } from '../execution/local-process'
import { LoginEnvProcessPort } from '../execution/login-env-process'
import { RoutedFileSystemPort } from '../execution/routed-filesystem'
import { RoutedProcessPort } from '../execution/routed-process'
import { ServiceRegistryPort } from '../services/service-registry'
import type { SettingsService } from '../settings/service'
import { ShellRegistryPort } from '../shells/shell-registry'

import type { ExecutionLocationState } from './execution-location-state'
import {
  DelegatingProcessPort,
  anchorRootFor,
  removeSandboxMountedElsewhere,
  resolveWorkspaceAnchor,
  retargetableStatus,
  type PrepareWorkspace,
  type WorkspaceAnchor,
} from './sandbox-reanchor'
import type { SandboxStatusState } from './sandbox-status-state'

export type SandboxControl = {
  noteBash: () => void
  stop: () => Promise<boolean>
  prepareWorkspace: (args: { cwd: string; threadId: ThreadId }) => Promise<void>
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function bindSandbox(args: {
  container: DependencyContainer
  engine: DockerEngine
  cwd: string
  sessionKey: () => string
  settings: SettingsService
  executionLocation: ExecutionLocationState
  notice: NoticePort
  atlasHome?: string | undefined
}): Promise<{
  sandbox: SandboxControl
  containerStatus: SandboxStatusState
  mounts: readonly string[]
}> {
  const { container, engine, cwd, settings, executionLocation, notice } = args

  let anchor: WorkspaceAnchor = await resolveWorkspaceAnchor({
    cwd,
    atlasHome: args.atlasHome,
    notice,
  })
  const mounts: string[] = [...anchor.mounts]

  const cpus = rangeValueOf({
    resolution: settings.snapshot().resolution,
    id: ESettingId.ContainerCpus,
    fallback: 4,
  })
  const memoryGb = rangeValueOf({
    resolution: settings.snapshot().resolution,
    id: ESettingId.ContainerMemory,
    fallback: 8,
  })
  const status = retargetableStatus({
    image: anchor.image,
    label: anchor.label,
    limits: { cpus, memoryGb },
  })

  let dockerPort: DockerProcessPort | undefined
  let boundSession: string | undefined

  const buildPort = (target: WorkspaceAnchor): DockerProcessPort => {
    const session = args.sessionKey()
    const built: DockerProcessPort = new DockerProcessPort({
      engine,
      sandbox: sandboxConfigFromHost({
        worktree: target.cwd,
        session,
        resolution: target.resolution,
        atlasHomeSubtrees: target.atlasSubtrees,
        limits: { cpus, memoryBytes: memoryGb * 1024 ** 3 },
      }),
      onStatus: (sandboxStatus) => {
        if (dockerPort !== built) return
        status.mark(sandboxStatus)
        if (sandboxStatus.state !== ESandboxState.Running) return

        built.warnings.forEach((warning, at) =>
          notice.notify({
            key: `sandbox-warning-${at}`,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: warning,
          }),
        )
      },
    })
    boundSession = session
    return built
  }

  const docker = (): DockerProcessPort => {
    if (dockerPort !== undefined) return dockerPort

    try {
      dockerPort = buildPort(anchor)
    } catch (error) {
      status.mark({ state: ESandboxState.Failed, reason: messageOf(error) })
      throw error
    }
    return dockerPort
  }

  const prepareWorkspace: PrepareWorkspace = async ({ cwd: requested }) => {
    const next = await anchorRootFor({ requested, current: anchor.cwd })
    const resolved =
      next === anchor.cwd
        ? undefined
        : await resolveWorkspaceAnchor({ cwd: next, atlasHome: args.atlasHome, notice })

    const removed = await removeSandboxMountedElsewhere({
      engine,
      session: args.sessionKey(),
      worktree: next,
    })

    if (resolved !== undefined) {
      try {
        dockerPort = buildPort(resolved)
      } catch (error) {
        status.mark({ state: ESandboxState.Failed, reason: messageOf(error) })
        throw error
      }
      anchor = resolved
      mounts.splice(0, mounts.length, ...resolved.mounts)
      status.retarget({ image: resolved.image, label: resolved.label })
    } else if (removed) {
      dockerPort?.sandboxStopped()
    }
    if (resolved !== undefined || removed) status.mark({ state: ESandboxState.Stopped })
  }

  container.register(portToken(ProcessPort), {
    useValue: new RoutedProcessPort({
      local: new LoginEnvProcessPort(new LocalProcessPort()),
      docker,
      locationOf: (threadId) =>
        (threadId === undefined ? undefined : executionLocation.of(threadId)) ??
        executionLocation.current(),
    }),
  })

  container.register(portToken(ExecutionLocationSinkPort), {
    useValue: {
      refresh: ({ threadId }) => executionLocation.refresh({ threadId }),
    },
  })

  container.register(portToken(AgentFileSystemPort), {
    useFactory: (resolver) =>
      new RoutedFileSystemPort({
        local: resolver.resolve(portToken(FileSystemPort)),
        dockerFor: () => new DockerFileSystemPort({ processes: new DelegatingProcessPort(docker) }),
        locationOf: (threadId) =>
          (threadId === undefined ? undefined : executionLocation.of(threadId)) ??
          executionLocation.current(),
      }),
  })

  const markStopped = (): void => {
    status.mark({ state: ESandboxState.Stopped })
    dockerPort?.sandboxStopped()
  }

  const idleStop = startIdleStop({
    engine,
    session: () => boundSession,
    runningShells: () =>
      container
        .resolve(portToken(ShellRegistryPort))
        .listEverywhere()
        .filter((shell) => shell.status === EShellStatus.Running).length,
    runningServices: () =>
      container
        .resolve(portToken(ServiceRegistryPort))
        .list()
        .filter((service) => service.status === EServiceStatus.Running).length,
    idleMinutes: () =>
      rangeValueOf({
        resolution: settings.snapshot().resolution,
        id: ESettingId.ContainerIdleMinutes,
        fallback: DEFAULT_CONTAINER_IDLE_MINUTES,
      }),
    onStopped: markStopped,
  })
  container.register(portToken(BeforeToolHook), {
    useValue: new BashActivityHook({ onBash: idleStop.noteBash }),
  })
  container.register(portToken(AfterToolHook), {
    useValue: new ReclaimWorktreeSandboxHook({ engine }),
  })
  registerDisposable({
    container,
    close: async () => idleStop.halt(),
  })

  const sandbox: SandboxControl = {
    noteBash: idleStop.noteBash,
    prepareWorkspace,
    stop: async () => {
      if (boundSession === undefined) return false
      const stopped = await stopSandbox({ engine, session: boundSession })
      if (stopped) markStopped()
      return stopped
    },
  }

  return { sandbox, containerStatus: status, mounts }
}
