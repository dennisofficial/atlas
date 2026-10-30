import { describe, expect, it } from 'bun:test'

import {
  SHIPPED_APP_DIRS,
  type WorkspaceManifest,
  affectedApps,
  isTestOrStoryPath,
  workspaceClosure,
} from '../release-affected'

const manifests: readonly WorkspaceManifest[] = [
  { dir: 'apps/tui', name: '@dltech/atlas', dependencies: ['@dltech/atlas-harness'] },
  { dir: 'apps/serve', name: '@dltech/atlas-serve', dependencies: ['@dltech/atlas-harness'] },
  { dir: 'apps/mac', name: '@dltech/atlas-mac', dependencies: ['@dltech/atlas-wire'] },
  { dir: 'apps/web', name: 'web', dependencies: ['@dltech/atlas-ui', '@dltech/atlas-wire'] },
  { dir: 'apps/api', name: '@dltech/atlas-api', dependencies: ['@dltech/atlas-db'] },
  {
    dir: 'packages/harness',
    name: '@dltech/atlas-harness',
    dependencies: ['@dltech/atlas-core', 'zod'],
  },
  { dir: 'packages/core', name: '@dltech/atlas-core', dependencies: [] },
  { dir: 'packages/ui', name: '@dltech/atlas-ui', dependencies: [] },
  { dir: 'packages/wire', name: '@dltech/atlas-wire', dependencies: [] },
  { dir: 'packages/db', name: '@dltech/atlas-db', dependencies: [] },
]

const affected = (changedPaths: readonly string[]): readonly string[] =>
  affectedApps({ manifests, apps: SHIPPED_APP_DIRS, changedPaths })

describe('workspaceClosure', () => {
  it('follows workspace dependencies transitively and ignores external ones', () => {
    expect(workspaceClosure({ manifests, rootDir: 'apps/tui' }).toSorted()).toEqual([
      'apps/tui',
      'packages/core',
      'packages/harness',
    ])
  })
})

describe('isTestOrStoryPath', () => {
  it('recognises specs, tests dirs and stories', () => {
    expect(isTestOrStoryPath('apps/tui/src/__tests__/helper.ts')).toBe(true)
    expect(isTestOrStoryPath('apps/api/src/thing.spec.ts')).toBe(true)
    expect(isTestOrStoryPath('packages/ui/src/button.stories.tsx')).toBe(true)
    expect(isTestOrStoryPath('apps/tui/src/spectrum.ts')).toBe(false)
  })
})

describe('affectedApps', () => {
  it('marks an app affected by a change inside it', () => {
    expect(affected(['apps/tui/src/app.tsx'])).toEqual(['apps/tui'])
  })

  it('marks web affected by a change in a package it depends on', () => {
    expect(affected(['packages/ui/src/button.tsx'])).toEqual(['apps/web'])
  })

  it('marks every app reaching a deep dependency', () => {
    expect(affected(['packages/core/src/index.ts'])).toEqual(['apps/tui', 'apps/serve'])
  })

  it('marks every app for a lockfile, root manifest or patch change', () => {
    for (const path of ['bun.lock', 'package.json', 'patches/foo.patch', 'tsconfig.base.json']) {
      expect(affected([path])).toEqual(SHIPPED_APP_DIRS)
    }
  })

  it('ignores a package-level bunfig that is not the root one', () => {
    expect(affected(['apps/api/bunfig.toml'])).toEqual([])
  })

  it('affects nothing for api-only, docs-only or deprecated-only changes', () => {
    expect(affected(['apps/api/src/main.ts', 'packages/db/prisma/schema.prisma'])).toEqual([])
    expect(affected(['docs/architecture.md', 'CLAUDE.md', 'deprecated/tui/x.ts'])).toEqual([])
  })

  it('affects nothing for spec-only and story-only changes', () => {
    expect(
      affected(['apps/tui/src/__tests__/app.spec.tsx', 'packages/ui/src/button.stories.tsx']),
    ).toEqual([])
  })

  it('does not match a sibling directory sharing a prefix', () => {
    expect(affected(['apps/webterm/index.ts'])).toEqual([])
  })
})
