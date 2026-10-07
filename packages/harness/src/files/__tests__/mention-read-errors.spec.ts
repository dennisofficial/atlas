import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FileBrowser } from '../file-browser'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('mention filesystem lookup failures', () => {
  it('does not turn an unreadable path into an empty listing or an absent file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-mention-errors-'))
    roots.push(root)
    await symlink('loop', join(root, 'loop'))
    const reader = new FileBrowser({ root })
    await expect(reader.list('loop')).rejects.toThrow('ELOOP')
    await expect(reader.exists('loop')).rejects.toThrow('ELOOP')
    await expect(reader.load('loop')).rejects.toThrow('ELOOP')
    await rm(join(root, 'loop'))
    await mkdir(join(root, 'loop'))
    expect(await reader.exists('loop')).toBe(true)
    expect(await reader.list('loop')).toEqual([])
  })

  it('still treats missing paths as absent rather than breaking ordinary @ prose', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-mention-missing-'))
    roots.push(root)
    const reader = new FileBrowser({ root })
    expect(await reader.list('missing')).toEqual([])
    expect(await reader.exists('missing')).toBe(false)
    expect(await reader.load('missing')).toMatchObject({
      type: 'refused',
      reason: 'it does not exist',
    })
  })
})
