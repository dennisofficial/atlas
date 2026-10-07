import { describe, expect, it } from 'bun:test'

import { verifyFamilyRestoration } from '../family-restoration-proof'
import type { RestoredWorkspace, WorkspaceManifest } from '../manifest'

const manifest: WorkspaceManifest = {
  version: 1, repository: { sourcePath: '/source/repo', originPath: '/host/repo' }, activeId: 'child', activeRelativePath: '',
  trees: [
    { id: 'main', name: 'main', sourcePath: '/source/repo', originPath: '/host/repo', branch: 'main', head: 'head-main', baseline: null, fingerprint: 'main-fingerprint', isMain: true },
    { id: 'child', name: 'child', sourcePath: '/source/repo/child', originPath: '/host/repo/child', branch: 'child', head: 'head-child', baseline: null, fingerprint: 'child-fingerprint', isMain: false },
  ],
  family: {
    rootId: 'root', checkouts: [{ id: 'generation', treeId: 'child', claimedBy: 'root' }],
    threads: [{ threadId: 'root', home: { treeId: 'main', relativePath: 'src' }, active: { treeId: 'child', base: 'origin/main', adopted: false } }],
  },
}

const restored: RestoredWorkspace = {
  cwd: '/host/repo/child-abcd', repository: '/host/repo',
  trees: [
    { id: 'main', sourcePath: '/source/repo', path: '/host/repo', branch: 'main', renamedFrom: null },
    { id: 'child', sourcePath: '/source/repo/child', path: '/host/repo/child-abcd', branch: 'child-abcd', renamedFrom: 'child' },
  ],
  family: {
    rootId: 'root', checkouts: [{ id: 'generation', path: '/host/repo/child-abcd', claimedBy: 'root' }],
    threads: [{ threadId: 'root', home: '/host/repo/src', active: { path: '/host/repo/child-abcd', branch: 'child-abcd', base: 'origin/main', adopted: false } }],
  },
}

describe('destination proof of the captured family mapping', () => {
  it('accepts renamed destinations only when checkout and per-thread identities match', () => {
    expect(() => verifyFamilyRestoration({ manifest, restored })).not.toThrow()
  })

  it('refuses a destination that omitted the mapping before ownership commits', () => {
    expect(() => verifyFamilyRestoration({ manifest, restored: { ...restored, family: undefined } })).toThrow('mapping')
  })

  it('refuses an incorrect home instead of accepting an ancestor fallback', () => {
    const family = restored.family
    if (family === undefined) throw new Error('fixture has no family')
    expect(() => verifyFamilyRestoration({ manifest, restored: { ...restored, family: { ...family, threads: family.threads.map((member) => ({ ...member, home: '/host/repo' })) } } })).toThrow('home mapping')
  })

  it('refuses lost retained generations even when every active directory landed', () => {
    const family = restored.family
    if (family === undefined) throw new Error('fixture has no family')
    expect(() => verifyFamilyRestoration({ manifest, restored: { ...restored, family: { ...family, checkouts: [] } } })).toThrow('generations')
  })

  it('refuses altered creation/adoption policy at a renamed checkout', () => {
    const family = restored.family
    if (family === undefined) throw new Error('fixture has no family')
    expect(() => verifyFamilyRestoration({ manifest, restored: { ...restored, family: { ...family, threads: family.threads.map((member) => ({ ...member, active: member.active === null ? null : { ...member.active, adopted: true } })) } } })).toThrow('active mapping')
  })
})
