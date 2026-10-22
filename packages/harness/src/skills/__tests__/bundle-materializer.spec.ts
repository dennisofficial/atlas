import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { bundleCacheRoot, materializeSkillBundle } from '../bundle-materializer'
import {
  bundleDigestOf,
  digestOfBytes,
  digestOfText,
  type EmbeddedSkillEntry,
  type EmbeddedSkillFile,
} from '../embedded-bundle'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bundle-materializer-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const fileOf = (args: { path: string; bytes: Uint8Array; reads?: { count: number } }): EmbeddedSkillFile => ({
  path: args.path,
  digest: digestOfBytes(args.bytes),
  read: async () => {
    if (args.reads !== undefined) args.reads.count += 1
    return args.bytes
  },
})

const SKILL_TEXT = '---\nname: demo\ndescription: A demo.\n---\n\nSee references/a.md.\n'
const BINARY = new Uint8Array([0, 255, 254, 0, 1, 128, 0xff, 0xd8, 0, 0])
const JSONC = new TextEncoder().encode('{\n  // comment\n  "a": 1,\n}\n')

const entryOf = (args: { files: readonly EmbeddedSkillFile[]; text?: string }): EmbeddedSkillEntry => {
  const { files, text = SKILL_TEXT } = args
  return {
    path: 'demo/SKILL.md',
    text,
    bundle: {
      digest: bundleDigestOf({ entry: { path: 'SKILL.md', digest: digestOfText(text) }, files }),
      files,
    },
  }
}

const standardFiles = (): readonly EmbeddedSkillFile[] => [
  fileOf({ path: 'references/a.md', bytes: new TextEncoder().encode('# A\n') }),
  fileOf({ path: 'assets/page.jpg', bytes: BINARY }),
  fileOf({ path: 'assets/palette.jsonc', bytes: JSONC }),
]

const bytesAt = (path: string): Uint8Array => new Uint8Array(readFileSync(path))

describe('materializeSkillBundle', () => {
  it('writes SKILL.md and every resource byte-for-byte under bin/skills/<digest>/<name>', async () => {
    const entry = entryOf({ files: standardFiles() })
    const { directory, entryPath } = await materializeSkillBundle({ home, name: 'demo', entry })

    expect(directory).toBe(join(bundleCacheRoot(home), entry.bundle?.digest ?? '', 'demo'))
    expect(bundleCacheRoot(home)).toBe(join(home, 'bin', 'skills'))
    expect(entryPath).toBe(join(directory, 'SKILL.md'))
    expect(readFileSync(entryPath, 'utf8')).toBe(SKILL_TEXT)
    expect(bytesAt(join(directory, 'assets/page.jpg'))).toEqual(BINARY)
    expect(bytesAt(join(directory, 'assets/palette.jsonc'))).toEqual(JSONC)
    expect(readFileSync(join(directory, 'references/a.md'), 'utf8')).toBe('# A\n')
  })

  it('leaves no staging directories behind', async () => {
    const entry = entryOf({ files: standardFiles() })
    await materializeSkillBundle({ home, name: 'demo', entry })

    expect(readdirSync(bundleCacheRoot(home))).toEqual([entry.bundle?.digest ?? ''])
  })

  it('does not rewrite unchanged files on a later load', async () => {
    const entry = entryOf({ files: standardFiles() })
    const first = await materializeSkillBundle({ home, name: 'demo', entry })
    const before = lstatSync(join(first.directory, 'assets/page.jpg'), { bigint: true })

    await materializeSkillBundle({ home, name: 'demo', entry })
    const after = lstatSync(join(first.directory, 'assets/page.jpg'), { bigint: true })

    expect(after.ino).toBe(before.ino)
    expect(after.mtimeNs).toBe(before.mtimeNs)
  })

  it('repairs a deleted resource', async () => {
    const entry = entryOf({ files: standardFiles() })
    const { directory } = await materializeSkillBundle({ home, name: 'demo', entry })
    rmSync(join(directory, 'assets/page.jpg'))

    await materializeSkillBundle({ home, name: 'demo', entry })

    expect(bytesAt(join(directory, 'assets/page.jpg'))).toEqual(BINARY)
  })

  it('repairs a corrupted resource and a corrupted SKILL.md', async () => {
    const entry = entryOf({ files: standardFiles() })
    const { directory, entryPath } = await materializeSkillBundle({ home, name: 'demo', entry })
    writeFileSync(join(directory, 'assets/page.jpg'), 'tampered')
    writeFileSync(entryPath, 'tampered')

    await materializeSkillBundle({ home, name: 'demo', entry })

    expect(bytesAt(join(directory, 'assets/page.jpg'))).toEqual(BINARY)
    expect(readFileSync(entryPath, 'utf8')).toBe(SKILL_TEXT)
  })

  it('repairs a resource replaced by a symlink without writing through it', async () => {
    const entry = entryOf({ files: standardFiles() })
    const { directory } = await materializeSkillBundle({ home, name: 'demo', entry })
    const outside = join(home, 'outside.txt')
    writeFileSync(outside, 'untouched')
    rmSync(join(directory, 'assets/page.jpg'))
    symlinkSync(outside, join(directory, 'assets/page.jpg'))

    await materializeSkillBundle({ home, name: 'demo', entry })

    expect(readFileSync(outside, 'utf8')).toBe('untouched')
    expect(lstatSync(join(directory, 'assets/page.jpg')).isSymbolicLink()).toBe(false)
    expect(bytesAt(join(directory, 'assets/page.jpg'))).toEqual(BINARY)
  })

  it('does not write through a symlinked resource directory', async () => {
    const entry = entryOf({ files: standardFiles() })
    const { directory } = await materializeSkillBundle({ home, name: 'demo', entry })
    const outside = join(home, 'outside-dir')
    mkdirSync(outside)
    rmSync(join(directory, 'assets'), { recursive: true })
    symlinkSync(outside, join(directory, 'assets'))

    await materializeSkillBundle({ home, name: 'demo', entry })

    expect(readdirSync(outside)).toEqual([])
    expect(bytesAt(join(directory, 'assets/page.jpg'))).toEqual(BINARY)
  })

  it('replaces a symlinked resource directory even when the bytes behind it already match', async () => {
    const entry = entryOf({ files: standardFiles() })
    const { directory } = await materializeSkillBundle({ home, name: 'demo', entry })
    const outside = join(home, 'outside-assets')
    renameSync(join(directory, 'assets'), outside)
    symlinkSync(outside, join(directory, 'assets'))

    await materializeSkillBundle({ home, name: 'demo', entry })

    expect(lstatSync(join(directory, 'assets')).isSymbolicLink()).toBe(false)
    expect(bytesAt(join(directory, 'assets/page.jpg'))).toEqual(BINARY)
    expect(readFileSync(join(outside, 'page.jpg'))).toEqual(Buffer.from(BINARY))
  })

  it('replaces a symlinked skill directory even when the bytes behind it already match', async () => {
    const entry = entryOf({ files: standardFiles() })
    const { directory } = await materializeSkillBundle({ home, name: 'demo', entry })
    const outside = join(home, 'outside-skill')
    renameSync(directory, outside)
    symlinkSync(outside, directory)

    await materializeSkillBundle({ home, name: 'demo', entry })

    expect(lstatSync(directory).isSymbolicLink()).toBe(false)
    expect(bytesAt(join(directory, 'assets/page.jpg'))).toEqual(BINARY)
  })

  it('rejects bundle digests that are not 64 lowercase hex characters, before touching the cache', async () => {
    const files = standardFiles()
    const digests = ['../escape', '..', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}/`, '/abs', '']
    for (const digest of digests) {
      const entry: EmbeddedSkillEntry = { path: 'demo/SKILL.md', text: SKILL_TEXT, bundle: { digest, files } }
      await expect(materializeSkillBundle({ home, name: 'demo', entry })).rejects.toThrow('digest')
    }
    expect(existsSync(bundleCacheRoot(home))).toBe(false)
    expect(existsSync(join(home, 'escape'))).toBe(false)
  })

  it('rejects skill names that are not a single safe path segment', async () => {
    for (const name of ['foo/bar', '..', '.', '', '/abs', 'a\\b', '../x']) {
      await expect(
        materializeSkillBundle({ home, name, entry: entryOf({ files: standardFiles() }) }),
      ).rejects.toThrow('single')
    }
    expect(existsSync(bundleCacheRoot(home))).toBe(false)
  })

  it('rejects resource paths that escape the skill directory', async () => {
    const escapes = ['../evil.txt', '/abs.txt', 'a/../../b.txt', 'a\\b.txt', 'a//b.txt', './a.txt', '']
    for (const path of escapes) {
      const entry = entryOf({ files: [fileOf({ path, bytes: new Uint8Array([1]) })] })
      await expect(materializeSkillBundle({ home, name: 'demo', entry })).rejects.toThrow()
    }
    expect(existsSync(join(home, 'evil.txt'))).toBe(false)
    expect(existsSync(bundleCacheRoot(home)) ? readdirSync(bundleCacheRoot(home)) : []).toEqual([])
  })

  it('fails loudly, publishing nothing, when an embedded resource does not match its digest', async () => {
    const good = fileOf({ path: 'references/a.md', bytes: new Uint8Array([1, 2, 3]) })
    const bad: EmbeddedSkillFile = { ...good, read: async () => new Uint8Array([9]) }

    await expect(materializeSkillBundle({ home, name: 'demo', entry: entryOf({ files: [bad] }) })).rejects.toThrow(
      'does not match',
    )
    expect(readdirSync(bundleCacheRoot(home))).toEqual([])
  })

  it('fails transparently when the cache location is inaccessible', async () => {
    writeFileSync(join(home, 'bin'), 'a file where the directory must go')

    await expect(
      materializeSkillBundle({ home, name: 'demo', entry: entryOf({ files: standardFiles() }) }),
    ).rejects.toThrow()
  })

  it('coalesces concurrent loads and leaves one complete bundle', async () => {
    const reads = { count: 0 }
    const entry = entryOf({ files: [fileOf({ path: 'assets/page.jpg', bytes: BINARY, reads })] })

    const results = await Promise.all(
      Array.from({ length: 8 }, () => materializeSkillBundle({ home, name: 'demo', entry })),
    )

    expect(new Set(results.map((result) => result.directory)).size).toBe(1)
    expect(reads.count).toBeLessThanOrEqual(2)
    expect(bytesAt(join(results[0]?.directory ?? '', 'assets/page.jpg'))).toEqual(BINARY)
  })

  it('completes a bundle whose directory another process published partially', async () => {
    const entry = entryOf({ files: standardFiles() })
    const digest = entry.bundle?.digest ?? ''
    const winner = join(bundleCacheRoot(home), digest, 'demo')
    mkdirSync(join(winner, 'assets'), { recursive: true })
    writeFileSync(join(winner, 'SKILL.md'), 'partial')

    const { directory } = await materializeSkillBundle({ home, name: 'demo', entry })

    expect(directory).toBe(winner)
    expect(readFileSync(join(winner, 'SKILL.md'), 'utf8')).toBe(SKILL_TEXT)
    expect(bytesAt(join(winner, 'assets/page.jpg'))).toEqual(BINARY)
    expect(readdirSync(bundleCacheRoot(home))).toEqual([digest])
  })

  it('keys the cache by bundle digest so changed content gets a fresh directory', async () => {
    const first = await materializeSkillBundle({ home, name: 'demo', entry: entryOf({ files: standardFiles() }) })
    const second = await materializeSkillBundle({
      home,
      name: 'demo',
      entry: entryOf({ files: standardFiles(), text: `${SKILL_TEXT}\nMore.\n` }),
    })

    expect(second.directory).not.toBe(first.directory)
    expect(readFileSync(first.entryPath, 'utf8')).toBe(SKILL_TEXT)
  })
})
