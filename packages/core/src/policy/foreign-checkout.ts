import { isUnderPath, normalisePath, resolveAgainst } from './classifier/path-set'
import { hasSegment, insideTemporaryRoot, isPersonalDotPath, segmentsOf } from './classifier/shapes'

const CHECKOUT_SEGMENTS: ReadonlySet<string> = new Set(['worktrees', '.git'])

function crossesIntoNestedCheckout({
  projectDirectory,
  resolved,
}: {
  projectDirectory: string
  resolved: string
}): boolean {
  const root = normalisePath({ path: projectDirectory })
  if (resolved === root) return false
  const below = segmentsOf({ path: resolved.slice(root.length) })
  return below.some((segment) => CHECKOUT_SEGMENTS.has(segment))
}

export function foreignCheckoutDenial({
  path,
  projectDirectory,
}: {
  path: string
  projectDirectory: string
}): string | undefined {
  const resolved = resolveAgainst({ base: projectDirectory, path })
  if (!hasSegment({ path: resolved, segments: CHECKOUT_SEGMENTS })) return undefined

  if (isUnderPath({ directory: projectDirectory, path: resolved })) {
    if (!crossesIntoNestedCheckout({ projectDirectory, resolved })) return undefined
  } else {
    if (insideTemporaryRoot({ path: resolved })) return undefined
    if (isPersonalDotPath({ path: resolved })) return undefined
  }

  return `Refusing to write to ${resolved}: it lies inside a checkout this session has not entered (the "worktrees" or ".git" segment gives it away), and this session's tree is ${projectDirectory}. Call enter_worktree with that checkout's path first, then make the edit from inside it, so the session, its diffs and its PR stay in one tree.`
}
