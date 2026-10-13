import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ETarEntryKind, tarEntries, type TarEntry } from '../../../execution/image/tar'
import { scanWorkspaceArchive } from '../restore-archive'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const manifestEntry = (): TarEntry => ({
  name: 'manifest.json',
  body: new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      repository: null,
      activeId: 'main',
      activeRelativePath: '',
      trees: [{ id: 'main', name: 'x', sourcePath: '/x', originPath: '/x', branch: null, head: null, baseline: null, fingerprint: 'f', isMain: true }],
    }),
  ),
})

const BLOCK = 512
const manifestBodyLength = manifestEntry().body?.length ?? 0

const scanRaw = async (bytes: Uint8Array): Promise<string[]> => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-scan-'))
  directories.push(directory)
  const archivePath = join(directory, 'archive.tar')
  await writeFile(archivePath, bytes)
  return scanWorkspaceArchive({ archivePath, caseInsensitive: false })
}

const tailBeyond = (bytes: Uint8Array, keep: number): Uint8Array => {
  const cut = bytes.slice(0, keep)
  const padded = new Uint8Array(Math.ceil(cut.length / BLOCK) * BLOCK)
  padded.set(cut)
  return padded
}

describe('a truncated archive reaching the scanner', () => {
  it('accepts a well-formed archive end to end', async () => {
    const bytes = tarEntries({
      entries: [
        manifestEntry(),
        { name: 'trees/main/files/hello.txt', body: new TextEncoder().encode('hello\n') },
      ],
    })
    expect(await scanRaw(bytes)).toEqual([])
  })

  it('throws "archive is truncated" when a zero block arrives while a file body is still owed', async () => {
    const body = new TextEncoder().encode('x'.repeat(BLOCK * 3))
    const whole = tarEntries({
      entries: [
        manifestEntry(),
        { name: 'trees/main/files/big.bin', kind: ETarEntryKind.File, body },
      ],
    })
    const fileHeaderStart = BLOCK + Math.ceil(manifestBodyLength / BLOCK) * BLOCK
    const oneBodyBlock = fileHeaderStart + BLOCK + BLOCK
    const cut = tailBeyond(whole, oneBodyBlock)

    await expect(scanRaw(cut)).rejects.toThrow('archive is truncated')
  })

  it('does not read a truncated tail as a clean end-of-archive', async () => {
    const whole = tarEntries({
      entries: [manifestEntry(), { name: 'trees/main/files/a.txt', body: new TextEncoder().encode('a'.repeat(100)) }],
    })
    const withoutEoaMarker = whole.slice(0, whole.length - BLOCK * 2)
    const padded = new Uint8Array(Math.ceil(withoutEoaMarker.length / BLOCK) * BLOCK)
    padded.set(withoutEoaMarker)

    const result = await scanRaw(padded).then(
      () => 'accepted',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    expect(result === 'accepted' || result.includes('truncated')).toBe(true)
  })

  it('throws "archive is truncated" at once when a zero block follows a header that still owes its entry', async () => {
    const longName = 'trees/main/files/owed.txt'
    const donor = tarEntries({ entries: [{ name: 'donor', body: new TextEncoder().encode(`${longName}\0`) }] })
    const header = donor.slice(0, BLOCK)
    header[156] = 'L'.charCodeAt(0)
    const body = donor.slice(BLOCK, BLOCK * 2)
    const bytes = new Uint8Array(BLOCK * 4)
    bytes.set(header, 0)
    bytes.set(body, BLOCK)

    await expect(scanRaw(bytes)).rejects.toThrow('archive is truncated')
  })

  it('throws "archive is truncated" when the stream ends at a block boundary with no end-of-archive marker', async () => {
    const whole = tarEntries({ entries: [manifestEntry(), { name: 'trees/main/files/a.txt', body: new TextEncoder().encode('a') }] })

    await expect(scanRaw(whole.slice(0, whole.length - BLOCK * 2))).rejects.toThrow('archive is truncated')
  })
})
