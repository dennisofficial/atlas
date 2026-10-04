import { ELogSeverity, type LogEntry, type LogPort, type ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '../../store/logs'

export type RelocationNode<Ctx> = {
  id: string
  needs: readonly string[]
  run: (ctx: Ctx) => Promise<void>
  commit?: boolean
  /** Operator-facing text. Nodes without one do invisible work and never reach a progress surface. */
  label?: string
}

export type RelocationPlan<Ctx> = readonly RelocationNode<Ctx>[]

export type RelocationRun =
  | { ok: true }
  | { ok: false; phase: 'pre-commit'; failed: string; error: unknown }
  | { ok: false; phase: 'committed'; failed: string; error: unknown }

const validatePlan = <Ctx>(plan: RelocationPlan<Ctx>): void => {
  const ids = new Set(plan.map((node) => node.id))
  for (const node of plan) {
    for (const need of node.needs) {
      if (!ids.has(need)) {
        throw new Error(`relocation plan: node '${node.id}' needs unknown node '${need}'`)
      }
    }
  }

  const settled = new Set<string>()
  let blocked = plan
  while (blocked.length > 0) {
    const advanced = blocked.filter((node) => node.needs.every((need) => settled.has(need)))
    if (advanced.length === 0) {
      const members = blocked.map((node) => node.id).join(', ')
      throw new Error(`relocation plan: dependency cycle among ${members}`)
    }
    for (const node of advanced) {
      settled.add(node.id)
    }
    blocked = blocked.filter((node) => !settled.has(node.id))
  }
}

export async function runRelocation<Ctx>(args: {
  plan: RelocationPlan<Ctx>
  ctx: Ctx
  onStep?: (id: string) => void
  onDone?: (id: string) => void
  isCommitted?: (() => boolean) | undefined
  /** When present, a failed node lands in the durable log before the run reports it. */
  log?: { port: LogPort; source: string; threadId: ThreadId } | undefined
}): Promise<RelocationRun> {
  validatePlan(args.plan)
  const done = new Set<string>()
  let committed = false

  const commitNode = args.plan.find((node) => node.commit === true)
  const postCommitIds = new Set<string>()
  if (commitNode !== undefined) {
    let frontier = [commitNode.id]
    while (frontier.length > 0) {
      const reached = frontier
      frontier = []
      for (const node of args.plan) {
        if (postCommitIds.has(node.id)) continue
        if (!node.needs.some((need) => reached.includes(need))) continue
        postCommitIds.add(node.id)
        frontier.push(node.id)
      }
    }
  }
  const preCommitIds = new Set<string>()
  if (commitNode !== undefined) {
    for (const node of args.plan) {
      if (node !== commitNode && !postCommitIds.has(node.id)) {
        preCommitIds.add(node.id)
      }
    }
  }

  const isRunnable = (node: RelocationNode<Ctx>): boolean => {
    if (done.has(node.id)) return false
    if (!node.needs.every((need) => done.has(need))) return false
    if (node.commit === true) {
      for (const id of preCommitIds) {
        if (!done.has(id)) return false
      }
    }
    return true
  }

  let failure: { failed: string; error: unknown } | null = null
  const running = new Map<string, Promise<void>>()

  const fire = (node: RelocationNode<Ctx>): void => {
    args.onStep?.(node.id)
    running.set(
      node.id,
      node
        .run(args.ctx)
        .then(() => {
          done.add(node.id)
          if (node.commit === true) committed = true
          args.onDone?.(node.id)
        })
        .catch((error: unknown) => {
          failure ??= { failed: node.id, error }
        }),
    )
  }

  while (done.size + running.size < args.plan.length || running.size > 0) {
    for (const node of args.plan) {
      if (running.has(node.id)) continue
      if (isRunnable(node)) fire(node)
    }

    if (running.size === 0) break
    await Promise.race([...running.values()])
    for (const [id, settled] of running) {
      if (done.has(id)) running.delete(id)
    }
    if (failure !== null) break
  }

  if (failure !== null) {
    await Promise.all(running.values())
    const { failed, error } = failure
    committed = committed || args.isCommitted?.() === true
    const phase = committed ? 'committed' : 'pre-commit'
    const entry: LogEntry = {
      severity: ELogSeverity.Error,
      source: args.log?.source ?? 'cloud.relocation',
      message: `the '${failed}' relocation node failed (${phase})`,
      threadId: args.log?.threadId,
      data: { nodeId: failed, phase },
      ...logFieldsOf({ error }),
    }
    args.log?.port.record(entry)
    return committed
      ? { ok: false, phase: 'committed', failed, error }
      : { ok: false, phase: 'pre-commit', failed, error }
  }

  return { ok: true }
}
