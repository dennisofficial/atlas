import type { EvalFeature } from './feature'

export type AnyEvalFeature = EvalFeature<unknown, unknown, unknown>

export class EvalRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvalRegistryError'
  }
}

export type EvalFeatureRegistry = {
  ids(): readonly string[]
  get(args: { id: string }): AnyEvalFeature
}

const byId = (left: AnyEvalFeature, right: AnyEvalFeature): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

export function createFeatureRegistry({ features }: { features: readonly AnyEvalFeature[] }): EvalFeatureRegistry {
  const seen = new Set<string>()
  for (const feature of features) {
    if (seen.has(feature.id)) throw new EvalRegistryError(`duplicate eval feature id "${feature.id}"`)
    seen.add(feature.id)
  }
  const ordered = [...features].sort(byId)
  const index = new Map(ordered.map((feature) => [feature.id, feature]))
  return {
    ids: () => ordered.map((feature) => feature.id),
    get: ({ id }) => {
      const feature = index.get(id)
      if (feature === undefined) {
        throw new EvalRegistryError(`unknown eval feature "${id}"; registered: ${ordered.map((f) => f.id).join(', ')}`)
      }
      return feature
    },
  }
}
