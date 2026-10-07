import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { makeTmpDir } from '../../../__fixtures__/curation'
import { sha256Hex } from '../../hash'
import { importHistoricalSessions } from '../historical-import'
import { makeLog, toDiskLines } from './historical-log'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

const tmp = async (): Promise<string> => {
  const dir = await makeTmpDir()
  created.push(dir)
  return dir
}

const SECRET = 'sk-live-SECRET-VALUE'
const A = '/proj/a.ts'
const V1 = `export const key = "${SECRET}"\n`

const writeThread = async ({ sessionDir, threadId, events }: { sessionDir: string; threadId: string; events: readonly unknown[] }): Promise<string> => {
  await mkdir(join(sessionDir, 'threads'), { recursive: true })
  const path = join(sessionDir, 'threads', `${threadId}.events.jsonl`)
  await writeFile(path, `${toDiskLines({ events }).join('\n')}\n`)
  return path
}

const creationLog = ({ threadId }: { threadId: string }) => {
  const log = makeLog({ threadId })
  log.write({ callId: 'c1', path: A, content: V1, created: true })
  return log
}

const readJsonl = async ({ path }: { path: string }): Promise<Record<string, unknown>[]> =>
  (await readFile(path, 'utf8')).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>)

const permissions = async ({ path }: { path: string }): Promise<number> => (await stat(path)).mode & 0o777

describe('importHistoricalSessions', () => {
  test('writes private changes, rejections and manifest for explicitly named sessions', async () => {
    const root = await tmp()
    const sessionDir = join(root, 'brn_one')
    const logPath = await writeThread({ sessionDir, threadId: 'th_1', events: creationLog({ threadId: 'th_1' }).events })
    const outputDir = join(root, 'out')

    const report = await importHistoricalSessions({ sessionDirs: [sessionDir], outputDir })

    expect(report).toEqual({ outputDir, sessions: 1, logs: 1, changes: 1, rejections: 0 })
    expect(JSON.stringify(report)).not.toContain(SECRET)
    expect((await readdir(outputDir)).sort()).toEqual(['changes.jsonl', 'manifest.json', 'rejections.jsonl'])
    const [change] = await readJsonl({ path: join(outputDir, 'changes.jsonl') })
    expect(change).toMatchObject({ session: 'brn_one', threadId: 'th_1', path: A, before: null, after: V1 })
    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      classification: 'raw_private',
      sanitized: false,
      providerReady: false,
      sessions: [{ session: 'brn_one', logs: [{ file: 'th_1.events.jsonl', sha256: sha256Hex({ text: await readFile(logPath, 'utf8') }), threadIds: ['th_1'], lines: 2, changes: 1, rejections: 0 }] }],
    })
    expect(JSON.stringify(manifest)).not.toContain(SECRET)
  })

  test('creates the output directory 0700 and every file 0600', async () => {
    const root = await tmp()
    const sessionDir = join(root, 's')
    await writeThread({ sessionDir, threadId: 'th_1', events: creationLog({ threadId: 'th_1' }).events })
    const outputDir = join(root, 'out')

    await importHistoricalSessions({ sessionDirs: [sessionDir], outputDir })

    expect(await permissions({ path: outputDir })).toBe(0o700)
    for (const name of await readdir(outputDir)) expect(await permissions({ path: join(outputDir, name) })).toBe(0o600)
  })

  test('refuses an output directory that already exists and leaves it untouched', async () => {
    const root = await tmp()
    const sessionDir = join(root, 's')
    await writeThread({ sessionDir, threadId: 'th_1', events: creationLog({ threadId: 'th_1' }).events })
    const outputDir = join(root, 'out')
    await mkdir(outputDir)
    await writeFile(join(outputDir, 'keep.txt'), 'keep')

    await expect(importHistoricalSessions({ sessionDirs: [sessionDir], outputDir })).rejects.toThrow('output directory already exists')

    expect(await readdir(outputDir)).toEqual(['keep.txt'])
  })

  test('refuses a session directory that does not exist before writing anything', async () => {
    const root = await tmp()
    const outputDir = join(root, 'out')

    await expect(importHistoricalSessions({ sessionDirs: [join(root, 'missing')], outputDir })).rejects.toThrow('session directory does not exist')

    expect(await readdir(root)).toEqual([])
  })

  test('reads only flat events logs of named sessions, never siblings, nested folders or ATLAS_HOME', async () => {
    const root = await tmp()
    const named = join(root, 'home', 'sessions', 'named')
    const sibling = join(root, 'home', 'sessions', 'sibling')
    await writeThread({ sessionDir: named, threadId: 'th_1', events: creationLog({ threadId: 'th_1' }).events })
    await writeThread({ sessionDir: sibling, threadId: 'th_9', events: creationLog({ threadId: 'th_9' }).events })
    await mkdir(join(named, 'threads', 'nested'), { recursive: true })
    await writeThread({ sessionDir: join(named, 'threads', 'nested'), threadId: 'th_8', events: creationLog({ threadId: 'th_8' }).events })
    await writeFile(join(named, 'threads', 'th_1.meta.json'), '{}')
    await mkdir(join(named, 'scratch'), { recursive: true })
    await writeFile(join(named, 'scratch', 'x.events.jsonl'), 'garbage')
    const previousHome = process.env['ATLAS_HOME']
    process.env['ATLAS_HOME'] = join(root, 'home')
    const outputDir = join(root, 'out')

    try {
      await importHistoricalSessions({ sessionDirs: [named], outputDir })
    } finally {
      if (previousHome === undefined) delete process.env['ATLAS_HOME']
      else process.env['ATLAS_HOME'] = previousHome
    }

    const changes = await readJsonl({ path: join(outputDir, 'changes.jsonl') })
    expect(changes.map((change) => change['threadId'])).toEqual(['th_1'])
    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as { sessions: { session: string; logs: { file: string }[] }[] }
    expect(manifest.sessions.map((entry) => [entry.session, entry.logs.map((log) => log.file)])).toEqual([['named', ['th_1.events.jsonl']]])
  })

  test('never carries an anchor from one thread or session to another', async () => {
    const root = await tmp()
    const one = join(root, 'one')
    const two = join(root, 'two')
    await writeThread({ sessionDir: one, threadId: 'th_1', events: creationLog({ threadId: 'th_1' }).events })
    const editing = makeLog({ threadId: 'th_2' })
    editing.edit({ callId: 'c1', path: A, before: V1, after: 'export const key = 2\n' })
    await writeThread({ sessionDir: two, threadId: 'th_2', events: editing.events })
    const outputDir = join(root, 'out')

    const report = await importHistoricalSessions({ sessionDirs: [two, one], outputDir })

    expect(report).toMatchObject({ sessions: 2, logs: 2, changes: 1, rejections: 1 })
    const [rejection] = await readJsonl({ path: join(outputDir, 'rejections.jsonl') })
    expect(rejection).toMatchObject({ session: 'two', threadId: 'th_2', kind: 'missing_before', path: A })
    expect(JSON.stringify(rejection)).not.toContain(SECRET)
  })

  test('quarantines every change from a log whose thread ids disagree with its file name', async () => {
    const root = await tmp()
    const sessionDir = join(root, 's')
    const log = creationLog({ threadId: 'th_other' })
    await writeThread({ sessionDir, threadId: 'th_1', events: log.events })
    const outputDir = join(root, 'out')

    const report = await importHistoricalSessions({ sessionDirs: [sessionDir], outputDir })

    expect(report).toMatchObject({ logs: 1, changes: 0, rejections: 1 })
    expect(await readJsonl({ path: join(outputDir, 'changes.jsonl') })).toEqual([])
    const rejections = await readJsonl({ path: join(outputDir, 'rejections.jsonl') })
    expect(rejections.map((entry) => entry['kind'])).toEqual(['thread_file_mismatch'])
    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as { changes: number; rejections: number; sessions: { logs: { changes: number; rejections: number; threadIds: string[] }[] }[] }
    expect(manifest).toMatchObject({ changes: 0, rejections: 1 })
    expect(manifest.sessions[0]?.logs[0]).toMatchObject({ changes: 0, rejections: 1, threadIds: ['th_other'] })
  })

  test('records malformed json lines without losing the valid changes around them', async () => {
    const root = await tmp()
    const sessionDir = join(root, 's')
    const logPath = await writeThread({ sessionDir, threadId: 'th_1', events: creationLog({ threadId: 'th_1' }).events })
    await writeFile(logPath, `${await readFile(logPath, 'utf8')}{not json\n`)
    const outputDir = join(root, 'out')

    const report = await importHistoricalSessions({ sessionDirs: [sessionDir], outputDir })

    expect(report).toMatchObject({ changes: 1, rejections: 1 })
    const rejections = await readJsonl({ path: join(outputDir, 'rejections.jsonl') })
    expect(rejections.map((entry) => entry['kind'])).toEqual(['malformed_event'])
  })

  test('still reads legacy flat core events from a log file', async () => {
    const root = await tmp()
    const sessionDir = join(root, 's')
    await mkdir(join(sessionDir, 'threads'), { recursive: true })
    const flat = creationLog({ threadId: 'th_1' }).events
    await writeFile(join(sessionDir, 'threads', 'th_1.events.jsonl'), `${flat.map((event) => JSON.stringify(event)).join('\n')}\n`)

    const report = await importHistoricalSessions({ sessionDirs: [sessionDir], outputDir: join(root, 'out') })

    expect(report).toMatchObject({ changes: 1, rejections: 0 })
  })

  test('leaves the source logs byte-identical', async () => {
    const root = await tmp()
    const sessionDir = join(root, 's')
    const logPath = await writeThread({ sessionDir, threadId: 'th_1', events: creationLog({ threadId: 'th_1' }).events })
    const before = await readFile(logPath, 'utf8')
    const modifiedBefore = (await stat(logPath)).mtimeMs

    await importHistoricalSessions({ sessionDirs: [sessionDir], outputDir: join(root, 'out') })

    expect(await readFile(logPath, 'utf8')).toBe(before)
    expect((await stat(logPath)).mtimeMs).toBe(modifiedBefore)
  })
})
