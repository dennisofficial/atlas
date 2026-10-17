import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { nodeWorkspaceFiles, refusesToEmpty } from '../workspace-files'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-empty-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('nodeWorkspaceFiles.empty', () => {
  it('clears every entry of a workspace directory', async () => {
    await writeFile(join(root, 'file'), 'x')
    await mkdir(join(root, 'dir'))
    await writeFile(join(root, 'dir', 'nested'), 'y')

    await nodeWorkspaceFiles.empty(root)

    expect(await readdir(root)).toEqual([])
  })

  it('refuses the filesystem root before touching anything', async () => {
    await expect(nodeWorkspaceFiles.empty('/')).rejects.toThrow('refusing to empty /')
  })

  it('refuses the home directory', async () => {
    await expect(nodeWorkspaceFiles.empty(homedir())).rejects.toThrow('refusing to empty')
  })
})

describe('refusesToEmpty', () => {
  it('names the root and home, in any spelling, and nothing else', () => {
    expect(refusesToEmpty('/')).toBe(true)
    expect(refusesToEmpty('/opt/..')).toBe(true)
    expect(refusesToEmpty(homedir())).toBe(true)
    expect(refusesToEmpty(`${homedir()}/`)).toBe(true)
    expect(refusesToEmpty('/opt/atlas/workspaces/workspace')).toBe(false)
    expect(refusesToEmpty(root)).toBe(false)
  })
})
