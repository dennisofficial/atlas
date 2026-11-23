import { describe, expect, it } from 'bun:test'

import {
  attachedFilesLineOf,
  contextFilePathOf,
  SPAWN_FILE_MAX_BYTES,
  SPAWN_FILES_MAX_BYTES,
  SPAWN_FILES_MAX_COUNT,
  spawnBriefOf,
  spawnFilesRefusalOf,
} from '../context-files'

const DIRECTORY = '/atlas/home/sessions/s-1/context'

const textOfBytes = (bytes: number): string => 'x'.repeat(bytes)

describe('contextFilePathOf', () => {
  it('joins a safe relative path under the context directory', () => {
    expect(contextFilePathOf({ directory: DIRECTORY, relativePath: 'plan.md' })).toEqual({
      ok: true,
      path: `${DIRECTORY}/plan.md`,
    })
  })

  it('keeps the folders of a nested path', () => {
    expect(
      contextFilePathOf({ directory: DIRECTORY, relativePath: 'sections/03-auth.md' }),
    ).toEqual({ ok: true, path: `${DIRECTORY}/sections/03-auth.md` })
  })

  it('accepts any name the agent gives, as long as it stays under the folder', () => {
    for (const relativePath of ['~notes.md', 'cost-$5.md', '.git/config', 'a\\b.md']) {
      expect(contextFilePathOf({ directory: DIRECTORY, relativePath })).toEqual({
        ok: true,
        path: `${DIRECTORY}/${relativePath}`,
      })
    }
  })

  it('tolerates a trailing slash on the directory', () => {
    expect(contextFilePathOf({ directory: `${DIRECTORY}/`, relativePath: 'plan.md' })).toEqual({
      ok: true,
      path: `${DIRECTORY}/plan.md`,
    })
  })

  it('refuses an empty path', () => {
    expect(contextFilePathOf({ directory: DIRECTORY, relativePath: '' })).toMatchObject({
      ok: false,
    })
  })

  it('refuses an absolute path', () => {
    expect(contextFilePathOf({ directory: DIRECTORY, relativePath: '/etc/hosts' })).toMatchObject({
      ok: false,
    })
  })

  it('refuses a path that climbs out of the folder', () => {
    for (const relativePath of ['../x.md', 'sections/../../x.md', '..', 'sections/..']) {
      expect(contextFilePathOf({ directory: DIRECTORY, relativePath })).toMatchObject({ ok: false })
    }
  })

  it('refuses a path with an empty or dot folder', () => {
    for (const relativePath of ['sections//x.md', './plan.md', 'sections/./x.md', '/plan.md']) {
      expect(contextFilePathOf({ directory: DIRECTORY, relativePath })).toMatchObject({ ok: false })
    }
  })

  it('refuses a path longer than the schema allows', () => {
    expect(
      contextFilePathOf({ directory: DIRECTORY, relativePath: `${'a'.repeat(201)}.md` }),
    ).toMatchObject({ ok: false })
  })
})

describe('spawnFilesRefusalOf', () => {
  it('accepts the files of a spawn that stays under every limit', () => {
    expect(
      spawnFilesRefusalOf([
        { path: 'plan.md', text: 'one' },
        { path: 'sections/03-auth.md', text: 'two' },
      ]),
    ).toBeNull()
  })

  it('accepts a spawn with no files at all', () => {
    expect(spawnFilesRefusalOf(undefined)).toBeNull()
    expect(spawnFilesRefusalOf([])).toBeNull()
  })

  it('refuses a file that holds a NUL byte, because it is not text', () => {
    expect(spawnFilesRefusalOf([{ path: 'binary.md', text: 'ab\u0000cd' }])).toContain('NUL')
  })

  it('refuses more files than the cap', () => {
    const files = Array.from({ length: SPAWN_FILES_MAX_COUNT + 1 }, (_unused, index) => ({
      path: `note-${index}.md`,
      text: 'x',
    }))
    expect(spawnFilesRefusalOf(files)).toContain(`${SPAWN_FILES_MAX_COUNT}`)
  })

  it('names the file that is too big on its own', () => {
    expect(
      spawnFilesRefusalOf([{ path: 'big.md', text: textOfBytes(SPAWN_FILE_MAX_BYTES + 1) }]),
    ).toContain('big.md')
  })

  it('refuses files too big together', () => {
    const files = Array.from({ length: 5 }, (_unused, index) => ({
      path: `note-${index}.md`,
      text: textOfBytes(SPAWN_FILE_MAX_BYTES),
    }))
    expect(spawnFilesRefusalOf(files)).toContain(`${SPAWN_FILES_MAX_BYTES}`)
  })

  it('refuses a file whose path leaves the context folder', () => {
    expect(spawnFilesRefusalOf([{ path: '../x.md', text: 'x' }])).toContain('../x.md')
  })

  it('measures bytes, not characters', () => {
    const text = 'é'.repeat(Math.ceil(SPAWN_FILE_MAX_BYTES / 2) + 1)
    expect(spawnFilesRefusalOf([{ path: 'accented.md', text }])).toContain('accented.md')
  })
})

describe('the brief of a spawn that attaches files', () => {
  it('names the attached paths on one line after the brief', () => {
    expect(
      spawnBriefOf({
        brief: 'Take the parser.',
        files: [
          { path: 'plan.md', text: 'one' },
          { path: 'sections/03-auth.md', text: 'two' },
        ],
      }),
    ).toBe('Take the parser.\n\nAttached to $ATLAS_CONTEXT_DIR: plan.md, sections/03-auth.md')
  })

  it('is the attached line alone when there is no brief', () => {
    expect(spawnBriefOf({ brief: undefined, files: [{ path: 'plan.md', text: 'one' }] })).toBe(
      'Attached to $ATLAS_CONTEXT_DIR: plan.md',
    )
  })

  it('is empty when there is neither a brief nor a file', () => {
    expect(spawnBriefOf({ brief: undefined, files: [] })).toBe('')
    expect(spawnBriefOf({ brief: '   ', files: [] })).toBe('')
  })

  it('writes the same line the helper hands back', () => {
    const files = [{ path: 'a.md', text: 'one' }]
    expect(attachedFilesLineOf(files)).toBe('Attached to $ATLAS_CONTEXT_DIR: a.md')
  })
})
