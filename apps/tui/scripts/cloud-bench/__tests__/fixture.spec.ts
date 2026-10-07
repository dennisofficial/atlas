import { lstatSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { cloneBenchmarkSession } from '../fixture'
import {
  BINARY,
  CHILD,
  cleanScratch,
  json,
  PROSE,
  put,
  ROOT,
  scratch,
  setup,
  treeOf,
} from './fixture-source'

type EventRow = {
  id: string
  seq: number
  runId: string
  threadId: string
  body: Record<string, unknown>
}

afterEach(cleanScratch)

describe('cloneBenchmarkSession', () => {
  it('clones into the destination home under fresh ids and leaves the source untouched', async () => {
    const { source, destinationHome, workspace } = setup()
    const before = treeOf(source)

    const clone = await cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })

    expect(clone.threadId).not.toBe(ROOT)
    expect(clone.threadIds).toHaveLength(2)
    expect(clone.threadIds[0]).toBe(clone.threadId)
    expect(new Set([...clone.threadIds, ROOT, CHILD]).size).toBe(4)
    expect(clone.sessionDirectory).toBe(join(destinationHome, 'sessions', clone.threadId))
    const [, newChild] = clone.threadIds
    const keys = Object.keys(treeOf(clone.sessionDirectory))
    expect(keys).toContain(`threads/${clone.threadId}.meta.json`)
    expect(keys).toContain(`threads/${clone.threadId}.events.jsonl`)
    expect(keys).toContain(`threads/${newChild}.events.jsonl`)
    expect(keys).toContain(`threads/${clone.threadId}/quality/report.bin`)
    const threadSegments = keys.map((key) => key.split('/').slice(0, 2).join('/'))
    expect(
      threadSegments.filter((segment) => segment.includes(ROOT) || segment.includes(CHILD)),
    ).toEqual([])
    expect(keys).toContain(`threads/${newChild}/notes/${CHILD}.json`)
    expect(treeOf(source)).toEqual(before)
  })

  it('rewrites metadata to a disposable host workspace and remaps relationships', async () => {
    const { source, destinationHome, workspace } = setup()

    const clone = await cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })
    const [newRoot, newChild] = clone.threadIds
    const read = (key: string): Record<string, unknown> =>
      JSON.parse(readFileSync(join(clone.sessionDirectory, key), 'utf8'))

    expect(read('meta.json')).toMatchObject({
      id: newRoot,
      home: 'host',
      repo: workspace,
      workspace,
      worktree: null,
      extra: 1,
      title: 'Big',
    })
    const root = read(`threads/${newRoot}.meta.json`)
    const child = read(`threads/${newChild}.meta.json`)
    for (const meta of [root, child]) {
      expect(meta).toMatchObject({
        workspace,
        repo: workspace,
        executionLocation: 'host',
        placement: { placement: { harness: 'host', tools: 'host' }, revision: 0, move: null },
        parkedTranscript: null,
        futureField: { keep: 'me' },
        modelRef: 'openai/gpt-x',
      })
    }
    expect(root.id).toBe(newRoot)
    expect(child).toMatchObject({ id: newChild, parentThreadId: newRoot, spawnerThreadId: newRoot })
  })

  it('remaps identity references in events and the ledger but keeps ids, seq, and prose', async () => {
    const { source, destinationHome, workspace } = setup()

    const clone = await cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })
    const [newRoot, newChild] = clone.threadIds
    const lines = (key: string): EventRow[] =>
      readFileSync(join(clone.sessionDirectory, key), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))

    const rootEvents = lines(`threads/${newRoot}.events.jsonl`)
    expect(rootEvents.map((event) => [event.id, event.seq, event.runId])).toEqual([
      ['evt_1', 1, 'run_1'],
      ['evt_2', 2, 'run_1'],
    ])
    expect(rootEvents.every((event) => event.threadId === newRoot)).toBe(true)
    expect(rootEvents[0]?.body.text).toBe(PROSE)
    expect(rootEvents[1]?.body).toMatchObject({ agentId: newChild, nested: [{ parent: newRoot }] })
    const [childEvent] = lines(`threads/${newChild}.events.jsonl`)
    expect(childEvent).toMatchObject({
      id: 'evt_3',
      threadId: newChild,
      runId: 'run_2',
      parentRunId: 'run_1',
    })
    const ledgerRows = lines('ledger.jsonl')
    expect(ledgerRows.map((line) => line.runId)).toEqual(['run_1', 'run_2'])
    expect(ledgerRows.map((line) => line.threadId)).toEqual([...clone.threadIds])
    expect(clone.events).toBe(3)
  })

  it('copies binaries and arbitrary json byte for byte into private files', async () => {
    const { source, destinationHome, workspace } = setup()
    const clone = await cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })
    const [newRoot, newChild] = clone.threadIds

    const copied = (key: string): Buffer => readFileSync(join(clone.sessionDirectory, key))
    expect(copied(`threads/${newRoot}/quality/report.bin`).equals(BINARY)).toBe(true)
    expect(copied('images/shot.png').equals(BINARY)).toBe(true)
    expect(copied('scratch/data.json').toString()).toBe(
      readFileSync(join(source, 'scratch/data.json'), 'utf8'),
    )
    expect(copied(`threads/${newChild}/notes/${CHILD}.json`).toString()).toContain(CHILD)
    expect(copied('context/plan.md').toString()).toBe(`plan for ${ROOT}\n`)
    expect(lstatSync(join(clone.sessionDirectory, 'images/shot.png')).ino).not.toBe(
      lstatSync(join(source, 'images/shot.png')).ino,
    )
  })

  it('skips the lock, symlinks, and machine-bound shell files', async () => {
    const { source, destinationHome, workspace } = setup()
    put(source, 'lock', '{"pid":1}')
    symlinkSync(join(source, 'meta.json'), join(source, 'alias.json'))
    const shell = `threads/${ROOT}/shells/shell_1`
    put(source, `${shell}/status.json`, json({ phase: 'exited' }))
    put(source, `${shell}/spool.out`, 'output')
    put(source, `${shell}/control.token`, 'secret')
    put(source, `${shell}/control.sock`, '')
    put(source, `${shell}/lock`, '')
    put(source, `${shell}/leases/a.lease`, '')

    const clone = await cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })
    const keys = Object.keys(treeOf(clone.sessionDirectory))
    const newShell = `threads/${clone.threadId}/shells/shell_1`

    expect(keys).toContain(`${newShell}/status.json`)
    expect(keys).toContain(`${newShell}/spool.out`)
    for (const excluded of [
      'lock',
      'alias.json',
      `${newShell}/control.token`,
      `${newShell}/control.sock`,
      `${newShell}/lock`,
      `${newShell}/leases/a.lease`,
    ]) {
      expect(keys).not.toContain(excluded)
    }
    expect(clone.files).toBe(keys.length)
  })

  it('refuses a source shell without terminal status and creates nothing', async () => {
    const { source, destinationHome, workspace } = setup()
    put(source, `threads/${ROOT}/shells/shell_1/status.json`, json({ phase: 'running' }))
    const before = treeOf(source)

    await expect(
      cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace }),
    ).rejects.toThrow(/terminal status/)

    expect(readdirSync(destinationHome)).toEqual([])
    expect(treeOf(source)).toEqual(before)
  })

  it('reports the sizes it read and wrote', async () => {
    const { source, destinationHome, workspace } = setup()
    const clone = await cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })
    const sourceSize = Object.values(treeOf(source)).reduce((sum, hex) => sum + hex.length / 2, 0)
    const copiedSize = Object.values(treeOf(clone.sessionDirectory)).reduce(
      (sum, hex) => sum + hex.length / 2,
      0,
    )

    expect(clone.sourceBytes).toBe(sourceSize)
    expect(clone.copiedBytes).toBe(copiedSize)
  })

  it('rejects a destination inside the source session', async () => {
    const { source, workspace } = setup()
    const before = treeOf(source)

    await expect(
      cloneBenchmarkSession({
        sourceSession: source,
        destinationHome: join(source, 'nested-home'),
        workspace,
      }),
    ).rejects.toThrow(/inside the source/)
    await expect(
      cloneBenchmarkSession({ sourceSession: source, destinationHome: source, workspace }),
    ).rejects.toThrow(/inside the source/)

    expect(treeOf(source)).toEqual(before)
  })

  it('never overwrites an existing destination session', async () => {
    const { source, destinationHome, workspace } = setup()
    const existing = join(destinationHome, 'sessions', 'brn_taken')
    put(existing, 'meta.json', 'keep me')
    const ids = ['brn_taken', 'brn_other']

    await expect(
      cloneBenchmarkSession({
        sourceSession: source,
        destinationHome,
        workspace,
        nextId: () => ids.shift() ?? 'brn_x',
      }),
    ).rejects.toThrow()

    expect(readFileSync(join(existing, 'meta.json'), 'utf8')).toBe('keep me')
    expect(readdirSync(existing)).toEqual(['meta.json'])
  })

  it('rejects colliding or unsafe supplied ids before writing anything', async () => {
    const { source, destinationHome, workspace } = setup()
    const run = (nextId: () => string): Promise<unknown> =>
      cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace, nextId })

    await expect(run(() => 'brn_same')).rejects.toThrow(/collides/)
    const sequence = [ROOT, 'brn_b']
    await expect(run(() => sequence.shift() ?? 'brn_z')).rejects.toThrow(/collides/)
    await expect(run(() => '../escape')).rejects.toThrow(/unsafe/)
    await expect(run(() => 'a/b')).rejects.toThrow(/unsafe/)

    expect(readdirSync(destinationHome)).toEqual([])
  })

  it('rejects a source without valid root metadata or without the root thread', async () => {
    const { source, destinationHome, workspace } = setup()
    const run = (): Promise<unknown> =>
      cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })

    rmSync(join(source, `threads/${ROOT}.meta.json`))
    await expect(run()).rejects.toThrow(/no thread metadata/)
    put(source, 'meta.json', '{"format":1}')
    await expect(run()).rejects.toThrow(/invalid root metadata/)
    rmSync(join(source, 'meta.json'))
    await expect(run()).rejects.toThrow()

    expect(readdirSync(destinationHome)).toEqual([])
  })

  it('keeps the partial artifact and names it when a copy fails midway', async () => {
    const { source, destinationHome, workspace } = setup()
    put(source, 'scratch/zzz.json', 'x')
    put(source, `threads/${CHILD}.meta.json`, json({ id: CHILD }))

    const failure = await cloneBenchmarkSession({
      sourceSession: source,
      destinationHome,
      workspace,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    const { sessionDirectory } = failure as { sessionDirectory: string }
    expect(sessionDirectory.startsWith(join(destinationHome, 'sessions'))).toBe(true)
    expect(lstatSync(sessionDirectory).isDirectory()).toBe(true)
  })
})
