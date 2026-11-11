import { createHash } from 'node:crypto'

import { afterAll, describe, expect, it } from 'bun:test'

import { hashFile } from '../index'

import { removeTempDirs, tempDir, writePath } from './temp'

afterAll(removeTempDirs)

const expectedOf = (contents: string): string => createHash('sha256').update(contents).digest('hex')

describe('hashFile', () => {
  it('matches node:crypto for a small file', async () => {
    const root = tempDir()
    const absolute = writePath({ root, path: 'README.md', contents: 'hello artifacts' })
    expect(await hashFile(absolute)).toBe(expectedOf('hello artifacts'))
  })

  it('matches node:crypto for a file larger than one chunk', async () => {
    const root = tempDir()
    const contents = 'x'.repeat(300_000)
    const absolute = writePath({ root, path: 'big.bin', contents })
    expect(await hashFile(absolute)).toBe(expectedOf(contents))
  })

  it('hashes an empty file', async () => {
    const root = tempDir()
    const absolute = writePath({ root, path: 'empty.txt', contents: '' })
    expect(await hashFile(absolute)).toBe(expectedOf(''))
  })
})
