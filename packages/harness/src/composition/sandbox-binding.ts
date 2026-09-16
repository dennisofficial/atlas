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
} from '@dltech/atlas-core'

import { registerDisposable } from '../container/disposal'
import { portToken, type DependencyContainer } from '../container/injection'
import { DockerFileSystemPort } from '../execution/docker/docker-filesystem'
import { DockerProcessPort } from '../execution/docker/docker-process'
import type { DockerEngine } from '../execution/docker/engine'
import {
  mountedAtlasHomeSubtrees,
  sandboxConfigFromHost,
} from '../execution/docker/host-environment'
import {
  BashActivityHook,
  ReclaimWorktreeSandboxHook,
  startIdleStop,
  stopSandbox,
} from '../execution/docker/lifecycle'
import { ESandboxState } from '../execution/docker/status'
import { EImageKind, resolveContainerConfig } from '../execution/image/resolve'
import { LocalProcessPort } from '../execution/local-process'
import { RoutedFileSystemPort } from '../execution/routed-filesystem'
import { RoutedProcessPort } from '../execution/routed-process'
import { ServiceRegistryPort } from '../services/service-registry'
import type { SettingsService } from '../settings/service'
import { ShellRegistryPort } from '../shells/shell-registry'

import { imageLabelOf } from './container-label'
import type { ExecutionLocationState } from './execution-location-state'
import { createSandboxStatusState, type SandboxStatusState } from './sandbox-status-state'

export type SandboxControl = {
  noteBash: () => void
  stop: () => Promise<boolean>
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function bindSandbox(args: {
  container: DependencyContainer
  engine: DockerEngine
  cwd: string
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

  const resolution = await resolveContainerConfig({ projectDirectory: cwd, atlasHome: args.atlasHome })
  const atlasSubtrees = mountedAtlasHomeSubtrees({
    worktree: cwd,
    declared: resolution.mounts,
    atlasHome: args.atlasHome,
  })
  const mounts = [
    ...resolution.mounts.map((mount) => mount.path),
    ...atlasSubtrees.map((subtree) => subtree.path),
  ]
  for (const refusal of resolution.refusals) {
    notice.notify({
      key: `container-refusal:${refusal.file}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `${refusal.file}: ${refusal.detail}`,
    })
  }

  const image =
    resolution.image.kind === EImageKind.Image ? resolution.image.reference : resolution.image.path
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
  const status = createSandboxStatusState({
    image,
    label: imageLabelOf(resolution.image),
    limits: { cpus, memoryGb },
  })

  let dockerPort: DockerProcessPort | undefined
  const docker = (): DockerProcessPort => {
    if (dockerPort !== undefined) return dockerPort

    try {
      dockerPort = new DockerProcessPort({
        engine,
        sandbox: sandboxConfigFromHost({
          worktree: cwd,
          resolution,
          atlasHomeSubtrees: atlasSubtrees,
          limits: { cpus, memoryBytes: memoryGb * 1024 ** 3 },
        }),
        onStatus: (sandboxStatus) => {
          status.mark(sandboxStatus)
          if (sandboxStatus.state !== ESandboxState.Running) return

          dockerPort?.warnings.forEach((warning, at) =>
            notice.notify({
              key: `sandbox-warning-${at}`,
              tone: ENoticeTone.Warn,
              ttlMs: NOTICE_WARN_MS,
              text: warning,
            }),
          )
        },
      })
    } catch (error) {
      status.mark({ state: ESandboxState.Failed, reason: messageOf(error) })
      throw error
    }
    return dockerPort
  }

  container.register(portToken(ProcessPort), {
    useValue: new RoutedProcessPort({
      local: new LocalProcessPort(),
      docker,
      locationOf: (threadId) =>
        (threadId === undefined ? undefined : executionLocation.of(threadId)) ??
        executionLocation.current(),
    }),
  })

  container.register(portToken(ExecutionLocationSinkPort), {
    useValue: {
      note: ({ threadId, location }) => executionLocation.note({ threadId, location }),
    },
  })

  container.register(portToken(AgentFileSystemPort), {
    useFactory: (resolver) =>
      new RoutedFileSystemPort({
        local: resolver.resolve(portToken(FileSystemPort)),
        dockerFor: () => new DockerFileSystemPort({ processes: docker() }),
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
    worktree: cwd,
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
    stop: async () => {
      const stopped = await stopSandbox({ engine, worktree: cwd })
      if (stopped) markStopped()
      return stopped
    },
  }

  return { sandbox, containerStatus: status, mounts }
}
