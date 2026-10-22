import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nodeWorkspaceFiles } from '../workspace-files'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-exclusive-write-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const bytes = (text: string) => Buffer.from(text)

describe('nodeWorkspaceFiles.writeBytes', () => {
  it('overwrites by default', async () => {
    const path = join(root, 'a', 'file')
    await nodeWorkspaceFiles.writeBytes({ path, bytes: bytes('one') })
    await nodeWorkspaceFiles.writeBytes({ path, bytes: bytes('two') })

    expect(await readFile(path, 'utf8')).toBe('two')
  })

  it('leaves an existing file untouched when overwrite is false', async () => {
    const path = join(root, 'file')
    await writeFile(path, 'existing')

    await nodeWorkspaceFiles.writeBytes({ path, bytes: bytes('new'), overwrite: false })

    expect(await readFile(path, 'utf8')).toBe('existing')
  })

  it('keeps exactly one winner when exclusive writers race', async () => {
    const path = join(root, 'race')

    await Promise.all(
      ['a', 'b', 'c', 'd'].map((text) =>
        nodeWorkspaceFiles.writeBytes({ path, bytes: bytes(text), overwrite: false }),
      ),
    )

    expect(['a', 'b', 'c', 'd']).toContain(await readFile(path, 'utf8'))
  })

  it('still surfaces failures other than an existing file', async () => {
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'a file')

    await expect(
      nodeWorkspaceFiles.writeBytes({ path: join(blocker, 'child'), bytes: bytes('x'), overwrite: false }),
    ).rejects.toThrow()
  })
})
