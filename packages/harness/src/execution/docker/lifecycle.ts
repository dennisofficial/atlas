import { existsSync } from 'node:fs'

import {
  AfterToolHook,
  BeforeToolHook,
  EBeforeToolDecision,
  EStage,
  EWorktreeExit,
  exitedWorktreeOf,
  idleStopDue,
  staleSandboxes,
  type AfterTool,
  type BeforeTool,
  type HookOrder,
} from '@dltech/atlas-core'

import type { DockerEngine } from './engine'
import { DEFAULT_LABEL_PREFIX, sessionLabel, worktreeLabel } from './sandbox'

export type LifecycleEngine = Pick<
  DockerEngine,
  'listContainers' | 'listNetworks' | 'stopContainer' | 'removeContainer' | 'removeNetwork'
>

const findBySession = async (args: {
  engine: LifecycleEngine
  prefix: string
  session: string
}) =>
  args.engine.listContainers({
    labels: { [sessionLabel(args.prefix)]: args.session },
    all: true,
  })

const removeSessionNetworks = async (args: {
  engine: LifecycleEngine
  prefix: string
  session: string
}): Promise<void> => {
  const networks = await args.engine.listNetworks({
    labels: { [sessionLabel(args.prefix)]: args.session },
  })
  for (const network of networks) {
    await args.engine.removeNetwork({ id: network.id }).catch(() => undefined)
  }
}

export async function stopSandbox(args: {
  engine: LifecycleEngine
  session: string
  prefix?: string | undefined
}): Promise<boolean> {
  const prefix = args.prefix ?? DEFAULT_LABEL_PREFIX
  const found = await findBySession({ engine: args.engine, prefix, session: args.session })

  let stopped = false
  for (const one of found) {
    if (one.state !== 'running') continue
    await args.engine.stopContainer({ id: one.id })
    stopped = true
  }
  return stopped
}

export async function removeSandbox(args: {
  engine: LifecycleEngine
  session: string
  prefix?: string | undefined
}): Promise<boolean> {
  const prefix = args.prefix ?? DEFAULT_LABEL_PREFIX
  const found = await findBySession({ engine: args.engine, prefix, session: args.session })

  for (const one of found) await args.engine.removeContainer({ id: one.id })
  await removeSessionNetworks({ engine: args.engine, prefix, session: args.session })
  return found.length > 0
}

export async function removeSandboxesAtWorktree(args: {
  engine: LifecycleEngine
  worktree: string
  prefix?: string | undefined
}): Promise<number> {
  const prefix = args.prefix ?? DEFAULT_LABEL_PREFIX
  const matches = await args.engine.listContainers({
    labels: { [worktreeLabel(prefix)]: args.worktree },
    all: true,
  })

  for (const one of matches) await args.engine.removeContainer({ id: one.id })

  const networks = await args.engine.listNetworks({
    labels: { [worktreeLabel(prefix)]: args.worktree },
  })
  for (const network of networks) {
    await args.engine.removeNetwork({ id: network.id }).catch(() => undefined)
  }
  return matches.length
}

export async function sweepSandboxes(args: {
  engine: LifecycleEngine
  worktrees: readonly string[]
  prefix?: string | undefined
  exists?: ((path: string) => boolean) | undefined
}): Promise<readonly string[]> {
  const prefix = args.prefix ?? DEFAULT_LABEL_PREFIX
  const exists = args.exists ?? existsSync
  const labelled = await args.engine.listContainers({
    labels: { [worktreeLabel(prefix)]: undefined },
    all: true,
  })

  const stale = staleSandboxes({
    sandboxes: labelled.map((one) => ({ id: one.id, worktree: one.labels[worktreeLabel(prefix)] })),
    worktrees: args.worktrees,
    exists,
  })

  const removed: string[] = []
  for (const one of stale) {
    await args.engine.removeContainer({ id: one.id })
    if (one.worktree !== undefined) removed.push(one.worktree)
  }

  const networks = await args.engine.listNetworks({
    labels: { [worktreeLabel(prefix)]: undefined },
  })
  const staleNetworks = staleSandboxes({
    sandboxes: networks.map((one) => ({ id: one.id, worktree: one.labels[worktreeLabel(prefix)] })),
    worktrees: args.worktrees,
    exists,
  })
  for (const network of staleNetworks) {
    await args.engine.removeNetwork({ id: network.id }).catch(() => undefined)
  }
  return removed
}

export type IdleStop = {
  noteBash: () => void
  halt: () => void
}

const IDLE_TICK_MS = 60_000

export function startIdleStop(args: {
  engine: LifecycleEngine
  session: () => string | undefined
  runningShells: () => number
  runningServices?: (() => number) | undefined
  idleMinutes: () => number
  prefix?: string | undefined
  now?: (() => number) | undefined
  tickMs?: number | undefined
  onStopped?: (() => void) | undefined
}): IdleStop {
  const now = args.now ?? Date.now
  let lastBashAt = now()
  let stopping = false

  const tick = async (): Promise<void> => {
    if (stopping) return

    let due = false
    try {
      due = idleStopDue({
        lastBashAt,
        runningShells: args.runningShells(),
        runningServices: args.runningServices?.() ?? 0,
        idleMinutes: args.idleMinutes(),
        now: now(),
      })
    } catch {
      return
    }
    if (!due) return

    const session = args.session()
    if (session === undefined) return

    stopping = true
    try {
      const stopped = await stopSandbox({
        engine: args.engine,
        session,
        prefix: args.prefix,
      })
      if (stopped) args.onStopped?.()
    } catch {
      return
    } finally {
      stopping = false
    }
  }

  const timer = setInterval(() => void tick(), args.tickMs ?? IDLE_TICK_MS)
  timer.unref()

  return {
    noteBash: () => {
      lastBashAt = now()
    },
    halt: () => clearInterval(timer),
  }
}

const BASH_TOOL = 'bash'

export class BashActivityHook extends BeforeToolHook {
  readonly name = 'bash-activity'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 0 }

  private readonly onBash: () => void

  constructor(args: { onBash: () => void }) {
    super()
    this.onBash = args.onBash
  }

  readonly run: BeforeTool = async ({ call }) => {
    if (call.name === BASH_TOOL) this.onBash()
    return { decision: EBeforeToolDecision.Allow, input: call.input }
  }
}

export class ReclaimWorktreeSandboxHook extends AfterToolHook {
  readonly name = 'reclaim-worktree-sandbox'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 0 }

  private readonly engine: LifecycleEngine
  private readonly prefix: string | undefined

  constructor(args: { engine: LifecycleEngine; prefix?: string | undefined }) {
    super()
    this.engine = args.engine
    this.prefix = args.prefix
  }

  readonly run: AfterTool = async ({ result }) => {
    if (!result.ok) return {}

    const exited = exitedWorktreeOf(result.output)
    if (exited === undefined || exited.action !== EWorktreeExit.Remove) return {}

    await removeSandboxesAtWorktree({ engine: this.engine, worktree: exited.path, prefix: this.prefix })
    return {}
  }
}
