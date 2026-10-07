import { activeWorktreeOf, homeDirectoryOf, projectDirectoryOf, type Event, type ThreadId } from '@dltech/atlas-core'
import type { RestoredWorkspace } from '../src/index'

import { FEATURE_KEY } from './workspace-roundtrip-live-family'
import type { LiveFixture } from './workspace-roundtrip-live-fixture'

export type Placement = { threadId: ThreadId; key: string; project: string; home: string; active: string | undefined }

export const ROOT_KEY = 'root'
export const MAIN_KEY = 'main'

export const ownedSpecs = (fixture: LiveFixture) => [fixture.feature, ...fixture.teammates.map((teammate) => teammate.spec)]

export function cloudPathsOf(args: { fixture: LiveFixture; restored: RestoredWorkspace }): Map<string, string> {
  const paths = new Map<string, string>()
  for (const spec of ownedSpecs(args.fixture)) {
    const tree = args.restored.trees.find((candidate) => candidate.sourcePath === spec.path)
    if (tree === undefined) throw new Error(`the cloud did not restore the checkout owned for ${spec.key}`)
    paths.set(spec.key, tree.path)
  }
  if (args.restored.trees.some((tree) => tree.sourcePath === args.fixture.hostUnrelated.path)) throw new Error('the unrelated host checkout was transferred')
  if (args.restored.trees.length !== paths.size + 1) throw new Error(`expected ${paths.size + 1} restored trees, found ${args.restored.trees.length}`)
  return paths
}

export function expectedPlacements(args: { fixture: LiveFixture; pathOf: (key: string) => string }): Placement[] {
  const feature = args.pathOf(FEATURE_KEY)
  const teammates = args.fixture.teammates.map((teammate): Placement => {
    const own = args.pathOf(teammate.spec.key)
    return { threadId: teammate.threadId, key: teammate.spec.key, project: teammate.exitsKeep ? feature : own, home: feature, active: teammate.exitsKeep ? undefined : own }
  })
  return [{ threadId: args.fixture.threadId, key: ROOT_KEY, project: feature, home: feature, active: undefined }, ...teammates]
}

export function assertPlacement(args: { events: readonly Event[]; launchDirectory: string; expected: Placement; where: string }): void {
  const { events, launchDirectory, expected } = args
  const actual = {
    project: projectDirectoryOf({ events, launchDirectory }),
    home: homeDirectoryOf({ events, launchDirectory }),
    active: activeWorktreeOf(events)?.path,
  }
  for (const field of ['project', 'home', 'active'] as const) {
    if (actual[field] !== expected[field]) throw new Error(`${args.where}: thread ${expected.key} ${field} is ${String(actual[field])}, expected ${String(expected[field])}`)
  }
}
