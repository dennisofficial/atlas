import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ATLAS_HOME_ENV, toThreadId } from '@dltech/atlas-core'
import { atlasDirectory, describeArchiveFile, sessionDirectory } from '@dltech/atlas-harness'
import { SESSION_EXPORT_FILE_PATTERN, sessionArchiveDescriptorSchema } from '@dltech/atlas-wire'

import { serveSessionArchive } from '../serve-session-archive'

const thread = toThreadId('archived')

let heldHome: string | undefined
let scratchHome = ''

beforeEach(() => {
  heldHome = process.env[ATLAS_HOME_ENV]
  scratchHome = mkdtempSync(join(tmpdir(), 'atlas-serve-archive-spec-'))
  process.env[ATLAS_HOME_ENV] = scratchHome
})

afterEach(() => {
  if (heldHome === undefined) delete process.env[ATLAS_HOME_ENV]
  else process.env[ATLAS_HOME_ENV] = heldHome
  rmSync(scratchHome, { recursive: true, force: true })
})

const seedSession = (id = thread): void => {
  const dir = sessionDirectory({ home: atlasDirectory(), sessionId: id })
  mkdirSync(join(dir, 'threads'), { recursive: true })
  writeFileSync(join(dir, 'meta.json'), '{}')
}

const exportsDirectory = (): string => join(atlasDirectory(), 'exports')

describe('the served session archive', () => {
  it('ends the family shells before it builds the archive', async () => {
    seedSession()
    const order: string[] = []

    const archive = await serveSessionArchive({
      threadId: thread,
      endFamilyShells: async () => {
        order.push('ended')
      },
    })

    expect(order).toEqual(['ended'])
    expect(archive).not.toBeNull()
  })

  it('builds nothing when the family shells would not end', async () => {
    seedSession()

    await expect(
      serveSessionArchive({
        threadId: thread,
        endFamilyShells: async () => {
          throw new Error('still writing')
        },
      }),
    ).rejects.toThrow('still writing')
    expect(existsSync(exportsDirectory()) ? readdirSync(exportsDirectory()) : []).toEqual([])
  })

  it('answers a thread-bound descriptor of a file under the drive exports directory', async () => {
    seedSession()

    const archive = await serveSessionArchive({ threadId: thread })

    expect(archive).not.toBeNull()
    if (archive === null) return
    expect(sessionArchiveDescriptorSchema.parse(archive)).toEqual(archive)
    expect(archive.threadId).toBe(thread)
    expect(archive.path.startsWith(`${exportsDirectory()}/`)).toBe(true)
    const name = archive.path.slice(exportsDirectory().length + 1)
    expect(name).toMatch(/^session-archived-[a-f0-9]{12}\.tar\.gz$/)
    expect(SESSION_EXPORT_FILE_PATTERN.test(name)).toBe(true)
    expect(statSync(archive.path).size).toBe(archive.size)
    expect(await describeArchiveFile({ path: archive.path })).toEqual({ size: archive.size, sha256: archive.sha256 })
  })

  it('keeps an earlier generation a consumer may still be downloading when another export is prepared', async () => {
    seedSession()
    seedSession(toThreadId('other'))
    const first = await serveSessionArchive({ threadId: thread })
    const other = await serveSessionArchive({ threadId: toThreadId('other') })
    writeFileSync(join(exportsDirectory(), 'workspace-abc.tar.gz'), 'keep')

    const second = await serveSessionArchive({ threadId: thread })

    expect(second?.path).not.toBe(first?.path)
    expect(existsSync(first?.path ?? '')).toBe(true)
    expect(existsSync(second?.path ?? '')).toBe(true)
    expect(existsSync(other?.path ?? '')).toBe(true)
    expect(existsSync(join(exportsDirectory(), 'workspace-abc.tar.gz'))).toBe(true)
  })

  it('lets the caller release exactly the generation it owns, leaving the others', async () => {
    seedSession()
    const first = await serveSessionArchive({ threadId: thread })
    const second = await serveSessionArchive({ threadId: thread })

    rmSync(second?.path ?? '', { force: true })

    expect(existsSync(first?.path ?? '')).toBe(true)
    expect(existsSync(second?.path ?? '')).toBe(false)
  })

  it('answers null for a session that holds nothing', async () => {
    await expect(serveSessionArchive({ threadId: toThreadId('empty') })).resolves.toBeNull()
  })

  it('refuses a thread id that cannot name an export', async () => {
    await expect(serveSessionArchive({ threadId: toThreadId('../escape') })).rejects.toThrow('cannot name a session export')
  })
})
