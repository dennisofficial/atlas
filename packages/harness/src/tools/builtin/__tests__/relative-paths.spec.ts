import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { EditTool } from '../edit'
import { filePathSchema, resolveToolPath } from '../file-text'
import { GlobTool } from '../glob'
import { GrepTool } from '../grep'
import { ReadTool } from '../read'
import { WriteTool } from '../write'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-relative-paths-'))

  await mkdir(join(root, 'composition'), { recursive: true })
  await writeFile(join(root, 'composition', 'app.tsx'), 'export const app = true\n')
  await writeFile(join(root, 'top.ts'), 'const needle = 1\n')
})

const invoke = async (
  tool: ReadTool | EditTool | WriteTool | GlobTool | GrepTool,
  input: Record<string, unknown>,
): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'relative-paths',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })

describe('filePathSchema', () => {
  it('accepts a relative path', () => {
    expect(filePathSchema.safeParse('apps/tui/src/app.ts').success).toBe(true)
  })

  it('accepts an absolute path', () => {
    expect(filePathSchema.safeParse(join(root, 'top.ts')).success).toBe(true)
  })

  it('rejects an empty path', () => {
    expect(filePathSchema.safeParse('').success).toBe(false)
  })
})

describe('resolveToolPath', () => {
  it('leaves an absolute path untouched', () => {
    expect(resolveToolPath({ projectDirectory: root, path: '/x/y.ts' })).toEqual({
      ok: true,
      path: '/x/y.ts',
      anchored: false,
    })
  })

  it('anchors a relative path to the project directory', () => {
    expect(resolveToolPath({ projectDirectory: root, path: 'a/b.ts' })).toEqual({
      ok: true,
      path: join(root, 'a/b.ts'),
      anchored: true,
    })
  })

  it('expands a $VARIABLE reference before deciding the path is absolute', () => {
    expect(
      resolveToolPath({
        projectDirectory: root,
        path: '$ATLAS_SPEC_DIR/note.md',
        env: { ATLAS_SPEC_DIR: '/tmp/handoffs' },
      }),
    ).toEqual({ ok: true, path: '/tmp/handoffs/note.md', anchored: false })
  })

  it('expands the ${VARIABLE} form', () => {
    expect(
      resolveToolPath({
        projectDirectory: root,
        path: '${ATLAS_SPEC_DIR}/note.md',
        env: { ATLAS_SPEC_DIR: '/tmp/handoffs' },
      }),
    ).toEqual({ ok: true, path: '/tmp/handoffs/note.md', anchored: false })
  })

  it('expands a variable mid-path and still anchors a relative result', () => {
    expect(
      resolveToolPath({
        projectDirectory: root,
        path: 'out/$ATLAS_SPEC_BUILD/x.ts',
        env: { ATLAS_SPEC_BUILD: '42' },
      }),
    ).toEqual({ ok: true, path: join(root, 'out/42/x.ts'), anchored: true })
  })

  it('expands a leading tilde to the home directory', () => {
    expect(
      resolveToolPath({ projectDirectory: root, path: '~/notes.md', env: { HOME: '/home/dev' } }),
    ).toEqual({ ok: true, path: '/home/dev/notes.md', anchored: false })
  })

  it('refuses a variable that is not set rather than treating it as a literal directory', () => {
    const resolved = resolveToolPath({
      projectDirectory: root,
      path: '$ATLAS_SPEC_UNSET/note.md',
      env: {},
    })

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.reason).toContain('$ATLAS_SPEC_UNSET')
      expect(resolved.reason).toContain('not set')
    }
  })

  it('names every unset variable when there is more than one', () => {
    const resolved = resolveToolPath({
      projectDirectory: root,
      path: '$ATLAS_SPEC_A/$ATLAS_SPEC_B.md',
      env: {},
    })

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.reason).toContain('$ATLAS_SPEC_A')
      expect(resolved.reason).toContain('$ATLAS_SPEC_B')
    }
  })
})

describe('file tools resolve relative paths against the project directory without the hook', () => {
  it('reads a file named relative to the project directory', async () => {
    const outcome = await invoke(new ReadTool(), { path: 'top.ts' })

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.modelText).toContain('const needle = 1')
  })

  it('writes a file named relative to the project directory', async () => {
    const outcome = await invoke(new WriteTool(), { path: 'made.ts', content: 'const made = 2\n' })

    expect(outcome.ok).toBe(true)
    expect(await readFile(join(root, 'made.ts'), 'utf8')).toBe('const made = 2\n')
  })

  it('edits a file named relative to the project directory', async () => {
    const outcome = await invoke(new EditTool(), {
      path: 'top.ts',
      oldString: 'const needle = 1',
      newString: 'const needle = 2',
    })

    expect(outcome.ok).toBe(true)
    expect(await readFile(join(root, 'top.ts'), 'utf8')).toBe('const needle = 2\n')
  })

  it('globs from a directory named relative to the project directory', async () => {
    const outcome = await invoke(new GlobTool(), { pattern: '*.tsx', path: 'composition' })

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.modelText).toContain(join(root, 'composition', 'app.tsx'))
  })

  it('greps a path named relative to the project directory', async () => {
    const outcome = await invoke(new GrepTool(), { pattern: 'needle', path: 'top.ts' })

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.modelText).toContain('const needle = 2')
  })

  it('teaches the anchor when a relative path misses', async () => {
    const outcome = await invoke(new ReadTool(), { path: 'composition/gone.ts' })

    expect(outcome.ok).toBe(false)
    const reason = outcome.ok ? '' : outcome.reason
    expect(reason).toContain(`File does not exist: ${join(root, 'composition', 'gone.ts')}`)
    expect(reason).toContain(
      `composition/gone.ts resolved against the project directory ${root}`,
    )
  })
})

describe('file tools expand environment references in paths', () => {
  it('writes a file under a directory named through an environment variable', async () => {
    process.env['ATLAS_SPEC_WRITE_DIR'] = root
    try {
      const outcome = await invoke(new WriteTool(), {
        path: '$ATLAS_SPEC_WRITE_DIR/via-env.md',
        content: 'expanded\n',
      })

      expect(outcome.ok).toBe(true)
      expect(await readFile(join(root, 'via-env.md'), 'utf8')).toBe('expanded\n')
    } finally {
      delete process.env['ATLAS_SPEC_WRITE_DIR']
    }
  })

  it('refuses a path through an unset variable before anything is created', async () => {
    const outcome = await invoke(new WriteTool(), {
      path: '$ATLAS_SPEC_DEFINITELY_UNSET/handoff.md',
      content: 'nope\n',
    })

    expect(outcome.ok).toBe(false)
    const reason = outcome.ok ? '' : outcome.reason
    expect(reason).toContain('$ATLAS_SPEC_DEFINITELY_UNSET')
    expect(reason).toContain('not set')
    expect(reason).not.toContain('resolved against the project directory')
    expect(await Bun.file(join(root, '$ATLAS_SPEC_DEFINITELY_UNSET', 'handoff.md')).exists()).toBe(false)
  })

  it('reports the unset variable for a read, the tool the screenshot hit', async () => {
    const outcome = await invoke(new ReadTool(), { path: '$ATLAS_SPEC_DEFINITELY_UNSET/handoff.md' })

    expect(outcome.ok).toBe(false)
    const reason = outcome.ok ? '' : outcome.reason
    expect(reason).toContain('$ATLAS_SPEC_DEFINITELY_UNSET')
    expect(reason).toContain('not set')
  })

  it('reports the unset variable for a glob base directory', async () => {
    const outcome = await invoke(new GlobTool(), {
      pattern: '*.md',
      path: '$ATLAS_SPEC_DEFINITELY_UNSET',
    })

    expect(outcome.ok).toBe(false)
    const reason = outcome.ok ? '' : outcome.reason
    expect(reason).toContain('$ATLAS_SPEC_DEFINITELY_UNSET')
  })

  it('does not claim an env-anchored miss resolved against the project directory', async () => {
    process.env['ATLAS_SPEC_WRITE_DIR'] = root
    try {
      const outcome = await invoke(new ReadTool(), { path: '$ATLAS_SPEC_WRITE_DIR/gone.md' })

      expect(outcome.ok).toBe(false)
      const reason = outcome.ok ? '' : outcome.reason
      expect(reason).toContain(`File does not exist: ${join(root, 'gone.md')}`)
      expect(reason).not.toContain('resolved against the project directory')
    } finally {
      delete process.env['ATLAS_SPEC_WRITE_DIR']
    }
  })
})
