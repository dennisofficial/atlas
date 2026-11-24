import { EQualityScopeKind, type QualityScope } from '@dltech/atlas-core'

const isReviewable = (scope: QualityScope): boolean =>
  scope.after !== null && (scope.before !== scope.after || scope.beforeHash !== scope.afterHash)

const isNamedFunction = (scope: QualityScope): boolean =>
  scope.kind === EQualityScopeKind.Function && scope.name.trim() !== ''

function ancestorsOf({
  scope,
  index,
}: {
  scope: QualityScope
  index: ReadonlyMap<string, QualityScope>
}): readonly QualityScope[] {
  const chain: QualityScope[] = []
  const seen = new Set<string>([scope.id])
  let parentId = scope.parentScopeId
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = index.get(parentId)
    if (parent === undefined) break
    chain.push(parent)
    parentId = parent.parentScopeId
  }
  return chain
}

export function selectScopes({ scopes }: { scopes: readonly QualityScope[] }): readonly string[] {
  const index = new Map<string, QualityScope>()
  for (const scope of scopes) if (!index.has(scope.id)) index.set(scope.id, scope)

  const reviewable = [...index.values()].filter(isReviewable)
  const ancestorsFor = (scope: QualityScope): readonly QualityScope[] =>
    ancestorsOf({ scope, index })

  const classes = reviewable.filter(
    (scope) =>
      scope.kind === EQualityScopeKind.Class &&
      !ancestorsFor(scope).some(
        (ancestor) => ancestor.kind === EQualityScopeKind.Class && isReviewable(ancestor),
      ),
  )
  const selectedClassIds = new Set(classes.map((scope) => scope.id))

  const subjects = reviewable.filter(
    (scope) => scope.kind === EQualityScopeKind.Class || isNamedFunction(scope),
  )
  const enclosingIds = new Set(
    subjects.flatMap((scope) => ancestorsFor(scope).map((ancestor) => ancestor.id)),
  )

  const functions = reviewable.filter(
    (scope) =>
      isNamedFunction(scope) &&
      !enclosingIds.has(scope.id) &&
      !ancestorsFor(scope).some((ancestor) => selectedClassIds.has(ancestor.id)),
  )

  return [...classes, ...functions].map((scope) => scope.id).sort()
}
