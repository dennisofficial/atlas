import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  plainReceiptPath,
  readPlainWorkspaceReceipt,
  writePlainWorkspaceReceipt,
} from '../plain-receipt'
import { fingerprintWorkspaceTree } from '../capture-fingerprint'
import { capture, cleanupScratches, createScratch } from './capture-fixture'

afterAll(cleanupScratches)

const plainFolder = async (): Promise<string> => {
  const parent = await createScratch()
  const root = join(parent, 'project')
  await mkdir(join(root, 'sub'), { recursive: true })
  await writeFile(join(root, 'sub', 'a.txt'), 'a\n')
  return root
}

const RECEIPT = { version: 1, treeId: 'tree_plain', originPath: '/host/project', baseline: 'host-baseline' } as const

describe('plain folder receipt', () => {
  it('lives beside the folder, never inside it, and is keyed by the real path', async () => {
    const root = await plainFolder()
    const path = await plainReceiptPath({ root })
    expect(dirname(path)).toBe(dirname(root))
    expect(path.startsWith(root)).toBe(false)

    const link = join(dirname(root), 'link-to-project')
    await symlink(root, link)
    expect(await plainReceiptPath({ root: link })).toBe(path)

    const other = join(dirname(root), 'other')
    await mkdir(other)
    expect(await plainReceiptPath({ root: other })).not.toBe(path)
  })

  it('round-trips through write and read, and reads null when absent', async () => {
    const root = await plainFolder()
    const path = await plainReceiptPath({ root })
    expect(await readPlainWorkspaceReceipt({ path })).toBeNull()
    await writePlainWorkspaceReceipt({ path, receipt: { ...RECEIPT, generation: 2 } })
    expect(await readPlainWorkspaceReceipt({ path })).toEqual({ ...RECEIPT, generation: 2 })
    expect((await readdir(dirname(path))).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('rejects a malformed receipt instead of ignoring it', async () => {
    const root = await plainFolder()
    const path = await plainReceiptPath({ root })
    await writeFile(path, JSON.stringify({ version: 1 }))
    await expect(readPlainWorkspaceReceipt({ path })).rejects.toThrow()
  })
})

describe('capturing a plain folder', () => {
  it('writes nothing and reports a null baseline when no receipt exists', async () => {
    const root = await plainFolder()
    const before = await readdir(dirname(root))
    const { manifest } = await capture({ cwd: root })
    expect(await readdir(dirname(root))).toEqual(before)
    expect(manifest.trees[0]).toMatchObject({ id: 'main', name: 'main', originPath: root, baseline: null })
  })

  it('reuses id, origin and baseline from the sibling receipt', async () => {
    const root = await plainFolder()
    await writePlainWorkspaceReceipt({ path: await plainReceiptPath({ root }), receipt: RECEIPT })
    const before = await readdir(dirname(root))
    const { manifest, extracted } = await capture({ cwd: root })

    expect(manifest.repository).toBeNull()
    expect(manifest.activeId).toBe('tree_plain')
    expect(manifest.trees[0]).toMatchObject({
      id: 'tree_plain',
      name: 'main',
      isMain: true,
      sourcePath: root,
      originPath: '/host/project',
      baseline: 'host-baseline',
    })
    expect(await readdir(dirname(root))).toEqual(before)
    expect(await Bun.file(join(extracted, 'trees', 'tree_plain', 'files', 'sub', 'a.txt')).text()).toBe('a\n')
    expect((await readdir(join(extracted, 'trees', 'tree_plain', 'files'))).some((name) => name.includes('atlas-transfer'))).toBe(false)
  })

  it('keeps the fingerprint independent of the receipt', async () => {
    const root = await plainFolder()
    const bare = (await capture({ cwd: root })).manifest.trees[0]?.fingerprint
    await writePlainWorkspaceReceipt({ path: await plainReceiptPath({ root }), receipt: RECEIPT })
    const withReceipt = (await capture({ cwd: root })).manifest.trees[0]?.fingerprint
    expect(withReceipt).toBe(bare)
    expect(withReceipt).toBe(await fingerprintWorkspaceTree({ cwd: root }))
  })
})
