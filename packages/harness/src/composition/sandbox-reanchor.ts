import {
  isUnderPath,
  ProcessPort,
  type ProcessHandle,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'

import { probeWorkspace } from '../workspace/probe'
import { mountedAtlasHomeSubtrees } from '../execution/docker/host-environment'
import { removeSandbox, type LifecycleEngine } from '../execution/docker/lifecycle'
import {
  DEFAULT_LABEL_PREFIX,
  DEFAULT_SANDBOX_IMAGE,
  sessionLabel,
  worktreeLabel,
} from '../execution/docker/sandbox'
import type { Mount } from '../execution/image/mounts'

import { imageLabelOf } from './container-label'
import type { ExecutionLocationControl } from './execution-location-state'
import {
  createSandboxStatusState,
  type SandboxContainer,
  type SandboxLimits,
  type SandboxStatusState,
} from './sandbox-status-state'

export type PrepareWorkspace = (args: { cwd: string; threadId: ThreadId }) => Promise<void>

export type WorkspaceAnchoring = {
  launchDirectory: string
  prepare: PrepareWorkspace
}

export type AnchoringControl = ExecutionLocationControl & {
  anchoring?: WorkspaceAnchoring | undefined
}

export type WorkspaceAnchor = {
  cwd: string
  atlasSubtrees: readonly Mount[]
  mounts: readonly string[]
  image: string
  label: string
}

export async function resolveWorkspaceAnchor(args: {
  cwd: string
  atlasHome?: string | undefined
}): Promise<WorkspaceAnchor> {
  const atlasSubtrees = mountedAtlasHomeSubtrees({
    worktree: args.cwd,
    atlasHome: args.atlasHome,
  })

  return {
    cwd: args.cwd,
    atlasSubtrees,
    mounts: atlasSubtrees.map((subtree) => subtree.path),
    image: DEFAULT_SANDBOX_IMAGE,
    label: imageLabelOf(DEFAULT_SANDBOX_IMAGE),
  }
}

export async function anchorRootFor(args: { requested: string; current: string }): Promise<string> {
  const [wanted, held] = await Promise.all([
    probeWorkspace({ cwd: args.requested }),
    probeWorkspace({ cwd: args.current }),
  ])
  if (wanted.workspace === held.workspace) return args.current
  if (wanted.repo !== null) return wanted.workspace

  return isUnderPath({ directory: args.current, path: args.requested })
    ? args.current
    : args.requested
}

export async function removeSandboxMountedElsewhere(args: {
  engine: LifecycleEngine
  session: string
  worktree: string
}): Promise<boolean> {
  const found = await args.engine.listContainers({
    labels: { [sessionLabel(DEFAULT_LABEL_PREFIX)]: args.session },
  })
  const elsewhere = found.some(
    (one) => one.labels[worktreeLabel(DEFAULT_LABEL_PREFIX)] !== args.worktree,
  )
  if (!elsewhere) return false

  return await removeSandbox({ engine: args.engine, session: args.session })
}

export class DelegatingProcessPort extends ProcessPort {
  constructor(private readonly current: () => ProcessPort) {
    super()
  }

  spawn(args: SpawnCommand): ProcessHandle {
    return this.current().spawn(args)
  }

  which(args: { command: string; threadId?: ThreadId | undefined }): string | null {
    return this.current().which(args)
  }

  override async launchDetached(args: SpawnCommand): Promise<void> {
    const port = this.current()
    if (port.launchDetached === undefined)
      throw new Error('this execution location cannot launch a durable supervisor')
    await port.launchDetached(args)
  }
}

export type RetargetableStatus = SandboxStatusState & {
  retarget: (target: { image: string; label: string }) => void
}

export function retargetableStatus(args: {
  image: string
  label: string
  limits: SandboxLimits
}): RetargetableStatus {
  const base = createSandboxStatusState(args)
  const listeners = new Set<() => void>()
  let target = { image: args.image, label: args.label }
  let shown:
    | { source: SandboxContainer; target: typeof target; value: SandboxContainer }
    | undefined

  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  base.subscribe(emit)

  return {
    current: () => {
      const source = base.current()
      if (shown?.source === source && shown.target === target) return shown.value

      const value = { ...source, ...target }
      shown = { source, target, value }
      return value
    },
    mark: base.mark,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retarget: (next) => {
      target = next
      emit()
    },
  }
}
