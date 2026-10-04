import type { RelocationNode, RelocationPlan } from './dag'

export type RelocationWave = {
  label: string
  ids: readonly string[]
}

/**
 * Groups a plan's labeled nodes into topological layers — the nodes the operator watches. A node
 * with no label does silent work (key capture, landed-confirm, teardown) and never appears. Nodes
 * in one wave are unordered relative to each other: they run concurrently, so the overlay renders
 * them as a single stage rather than inventing a sequence the DAG does not have.
 */
export function relocationWaves<Ctx>(plan: RelocationPlan<Ctx>): RelocationWave[] {
  const settled = new Set<string>()
  const waves: RelocationWave[] = []
  let blocked = plan

  while (blocked.length > 0) {
    const layer = blocked.filter((node) => node.needs.every((need) => settled.has(need)))
    if (layer.length === 0) break

    const labeled = layer.filter((node) => node.label !== undefined)
    if (labeled.length > 0) {
      waves.push({
        label: labeled.map((node) => node.label).join(', '),
        ids: labeled.map((node) => node.id),
      })
    }

    for (const node of layer) settled.add(node.id)
    blocked = blocked.filter((node) => !settled.has(node.id))
  }

  return waves
}
