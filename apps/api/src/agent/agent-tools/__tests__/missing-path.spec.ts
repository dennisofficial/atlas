import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'bun:test'
import { files, processes } from './support'

import {
  toThreadId,
  type AgentFileSystemPort,
  type FileStat,
  type FileSystemEntry,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { GrepTool, type GrepInput } from '../grep'
import { ReadTool } from '../read'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-missing-path-'))

  await mkdir(join(root, 'composition', 'commands'), { recursive: true })
  await writeFile(join(root, 'composition', 'app.tsx'), 'export const app = true\n')
  await writeFile(join(root, 'composition', 'compose.ts'), 'export const compose = true\n')
  await writeFile(join(root, 'top.ts'), 'const needle = 1\n')
  await mkdir(join(root, 'vacant'))
})

const readTool = new ReadTool({ files })
const grepTool = new GrepTool(processes, files)

const read = async (path: string): Promise<ToolOutcome> =>
  readTool.invoke({
    input: { path },
    signal: new AbortController().signal,
    idempotencyKey: 'missing-path-read',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })

const search = async (input: GrepInput): Promise<ToolOutcome> =>
  grepTool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'missing-path-grep',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })

const reasonOf = (outcome: ToolOutcome): string => {
  expect(outcome.ok).toBe(false)
  return outcome.ok ? '' : outcome.reason
}

describe('a missing path tells the model what is actually there', () => {
  it('names the closest real entries when the file alone is missing', async () => {
    const missing = join(root, 'composition', 'atlas-app.ts')

    const reason = reasonOf(await read(missing))

    expect(reason).toContain(`File does not exist: ${missing}`)
    expect(reason).toContain('app.tsx')
    expect(reason).toContain('compose.ts')
  })

  it('marks directories so a file/directory mix-up is visible', async () => {
    const reason = reasonOf(await read(join(root, 'composition', 'atlas-app.ts')))

    expect(reason).toContain('commands/')
  })

  it('names the deepest existing directory when a middle segment is missing', async () => {
    const missing = join(root, 'composition', 'nested', 'deep.ts')

    const reason = reasonOf(await read(missing))

    expect(reason).toContain(`File does not exist: ${missing}`)
    expect(reason).toContain(join(root, 'composition'))
    expect(reason).toContain('app.tsx')
  })

  it('says so when the containing directory is empty', async () => {
    const reason = reasonOf(await read(join(root, 'vacant', 'gone.ts')))

    expect(reason).toContain('is empty')
  })

  it('fails a grep against a missing path with the same guidance instead of a spawn complaint', async () => {
    const missing = join(root, 'composition', 'atlas-app.ts')

    const reason = reasonOf(await search({ pattern: 'needle', path: missing }))

    expect(reason).toContain(`File does not exist: ${missing}`)
    expect(reason).toContain('app.tsx')
    expect(reason).not.toContain('exited')
  })

  it('still searches an existing path exactly as before', async () => {
    const outcome = await search({ pattern: 'needle', path: join(root, 'top.ts') })

    expect(outcome.ok).toBe(true)
  })
})

const JOURNAL_FAILED =
  'the call journal could not be written: the sandbox disk is full (ENOSPC). Free space or wait for the disk to grow.'

const failingFiles = (): AgentFileSystemPort =>
  Object.assign(Object.create(files), {
    stat: () => Promise.reject(new Error(JOURNAL_FAILED)),
  })

const VIRTUAL_ROOT = '/virtual/atlas'

const virtualFiles = (): AgentFileSystemPort =>
  Object.assign(Object.create(files), {
    stat: ({ path }: { path: string }) =>
      path === VIRTUAL_ROOT
        ? Promise.resolve(directoryStat)
        : Promise.reject(
            Object.assign(new Error(`ENOENT: no such file or directory '${path}'`), {
              code: 'ENOENT',
            }),
          ),
    readDirectory: ({ path }: { path: string }) =>
      Promise.resolve(path === VIRTUAL_ROOT ? virtualEntries : []),
  })

const directoryStat: FileStat = {
  size: 0,
  mode: 0o755,
  mtimeMs: 0,
  isFile: () => false,
  isDirectory: () => true,
}

const virtualEntries: readonly FileSystemEntry[] = [
  { name: 'sandbox-only.ts', isFile: () => true, isDirectory: () => false },
  { name: 'sandbox-only-dir', isFile: () => false, isDirectory: () => true },
]

describe('a sandbox call that failed is not reported as a missing file', () => {
  it('tells the model the sandbox could not answer instead of that the file does not exist', async () => {
    const read = new ReadTool({ files: failingFiles() }).invoke({
      input: { path: join(root, 'composition', 'app.tsx') },
      signal: new AbortController().signal,
      idempotencyKey: 'failing-stat-read',
      projectDirectory: root,
      threadId: toThreadId('thread-1'),
    })

    const error = await read.catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('the sandbox disk is full')
    expect((error as Error).message).not.toContain('File does not exist')
  })

  it('fails a grep the same way', async () => {
    const grep = new GrepTool(processes, failingFiles()).invoke({
      input: { pattern: 'needle', path: join(root, 'top.ts') },
      signal: new AbortController().signal,
      idempotencyKey: 'failing-stat-grep',
      projectDirectory: root,
      threadId: toThreadId('thread-1'),
    })

    const error = await grep.catch((caught: unknown) => caught)

    expect((error as Error).message).toContain('the sandbox disk is full')
    expect((error as Error).message).not.toContain('File does not exist')
  })

  it('lists the entries the sandbox reports, not the ones on this machine', async () => {
    const reason = reasonOf(
      await new ReadTool({ files: virtualFiles() }).invoke({
        input: { path: `${VIRTUAL_ROOT}/sandbox-only.tsx` },
        signal: new AbortController().signal,
        idempotencyKey: 'virtual-listing-read',
        projectDirectory: root,
        threadId: toThreadId('thread-1'),
      }),
    )

    expect(reason).toContain('sandbox-only.ts')
    expect(reason).toContain('sandbox-only-dir/')
    expect(reason).not.toContain('composition')
  })
})
