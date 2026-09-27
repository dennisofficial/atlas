export type RelocationNode<Ctx> = {
  id: string
  needs: readonly string[]
  run: (ctx: Ctx) => Promise<void>
  commit?: boolean
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
}): Promise<RelocationRun> {
  validatePlan(args.plan)
  const done = new Set<string>()
  let committed = false

  const commitNode = args.plan.find((node) => node.commit === true)
  const preCommitIds = new Set<string>()
  if (commitNode !== undefined) {
    for (const node of args.plan) {
      if (node !== commitNode && !node.needs.includes(commitNode.id)) {
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

  while (done.size < args.plan.length) {
    const ready = args.plan.filter(isRunnable)

    let failure: { failed: string; error: unknown } | null = null
    await Promise.all(
      ready.map(async (node) => {
        args.onStep?.(node.id)
        try {
          await node.run(args.ctx)
        } catch (error) {
          failure ??= { failed: node.id, error }
          return
        }
        done.add(node.id)
        if (node.commit === true) {
          committed = true
        }
      }),
    )

    if (failure !== null) {
      const { failed, error } = failure
      return committed
        ? { ok: false, phase: 'committed', failed, error }
        : { ok: false, phase: 'pre-commit', failed, error }
    }
  }

  return { ok: true }
}
