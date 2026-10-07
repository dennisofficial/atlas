import { describe, expect, it } from 'bun:test'

import {
  applyWorkspaceArchiveReplySchema,
  prepareWorkspaceArchiveReplySchema,
  workspaceManifestWireSchema,
} from '../workspace-transfer-wire'

const tree = {
  id: 'main',
  name: 'main',
  sourcePath: '/s',
  originPath: '/s',
  branch: 'main',
  head: 'h',
  baseline: null,
  fingerprint: 'f',
  isMain: true,
}
const family = {
  rootId: 'root',
  checkouts: [{ id: 'c1', treeId: 'main', claimedBy: 'root' }],
  threads: [
    { threadId: 'root', home: { treeId: 'main', relativePath: 'pkg/sub' }, active: { treeId: 'main', base: null, adopted: true } },
  ],
}
const manifest = { version: 1, repository: null, activeId: 'main', trees: [tree] }

describe('the family wire shapes', () => {
  it('keeps the manifest family instead of stripping it', () => {
    expect(workspaceManifestWireSchema.parse({ ...manifest, family }).family).toEqual(family)
  })

  it('leaves legacy manifests without a family untouched', () => {
    expect(workspaceManifestWireSchema.parse(manifest)).not.toHaveProperty('family')
  })

  it.each(['/abs', '../x', 'a/../b', 'a\\b', 'C:/x', 'a//b'])('rejects the unsafe home path %p', (relativePath) => {
    const unsafe = { ...family, threads: [{ ...family.threads[0], home: { treeId: 'main', relativePath } }] }
    expect(workspaceManifestWireSchema.safeParse({ ...manifest, family: unsafe }).success).toBe(false)
  })

  it('carries the cleanup verdict and sha256 on the prepare reply', () => {
    const cleanup = { generation: 'g', sourceSessionId: 's', safe: false, reasons: ['registry-changed'] }
    const parsed = prepareWorkspaceArchiveReplySchema.parse({ path: '/p', manifest, sha256: 'a'.repeat(64), cleanup })
    expect(parsed.sha256).toBe('a'.repeat(64))
    expect(parsed.cleanup).toEqual(cleanup)
    expect(prepareWorkspaceArchiveReplySchema.safeParse({ path: '/p', manifest, cleanup: { generation: 'g' } }).success).toBe(false)
  })

  it('keeps the restored family mapping on the apply reply', () => {
    const restoredFamily = {
      rootId: 'root',
      checkouts: [{ id: 'c1', path: '/r/wt', claimedBy: 'root' }],
      threads: [{ threadId: 'root', home: '/r', active: { path: '/r/wt', branch: 'b', base: null, adopted: false } }],
    }
    const reply = applyWorkspaceArchiveReplySchema.parse({
      applied: true,
      restored: { cwd: '/r', repository: '/r', trees: [], family: restoredFamily },
    })
    expect(reply.restored.family).toEqual(restoredFamily)
  })
})
