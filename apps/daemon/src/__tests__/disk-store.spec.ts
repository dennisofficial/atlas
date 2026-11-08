import { describe, expect, it } from 'bun:test'

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ECallStatus, EExecOutcome } from '@dltech/atlas-protocol'
import { type CallJournal, ECallJournalState } from '@dltech/atlas-protocol/engine'

import { DiskCallStore } from '../disk-store'

const doneJournal = (outputBytes: number): CallJournal => ({
  format: 1,
  state: ECallJournalState.Done,
  epoch: 1,
  op: { op: 'exec', argv: ['echo', 'hi'] },
  outputBytes,
  result: {
    status: ECallStatus.Ok,
    op: 'exec',
    value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes },
  },
})

const withHome = async (run: (home: string) => Promise<void>): Promise<void> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-disk-store-'))
  try {
    await run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

const seed = async (args: {
  store: DiskCallStore
  home: string
  key: string
  outputSize: number
  ageMs: number
}) => {
  const bytes = new Uint8Array(args.outputSize).fill(7)
  await args.store.writeState({ key: args.key, journal: doneJournal(args.outputSize) })
  await args.store.appendOutput({ key: args.key, bytes })
  const when = new Date(Date.now() - args.ageMs)
  for (const file of ['state.json', 'output.bin'])
    utimesSync(join(args.home, 'calls', args.key, file), when, when)
}

const keysOf = (home: string): string[] => readdirSync(join(home, 'calls')).sort()

const writeRawState = (args: { home: string; key: string; content: string }): void => {
  mkdirSync(join(args.home, 'calls', args.key), { recursive: true })
  writeFileSync(join(args.home, 'calls', args.key, 'state.json'), args.content)
}

describe('DiskCallStore', () => {
  it('keeps a fresh journal and its output across a boot', async () => {
    await withHome(async (home) => {
      const first = new DiskCallStore(home)
      await first.prune()
      await first.writeState({ key: 'k1', journal: doneJournal(3) })
      await first.appendOutput({ key: 'k1', bytes: new Uint8Array([1, 2, 3]) })

      const next = new DiskCallStore(home)
      await next.prune()

      expect(await next.readState({ key: 'k1' })).toEqual(doneJournal(3))
      expect(Array.from(await next.readOutput({ key: 'k1', offset: 0 }))).toEqual([1, 2, 3])
    })
  })

  it('creates the calls directory on a fresh home', async () => {
    await withHome(async (home) => {
      await new DiskCallStore(home).prune()
      expect(existsSync(join(home, 'calls'))).toBe(true)
    })
  })

  it('reads a missing or unreadable journal as undefined', async () => {
    await withHome(async (home) => {
      const store = new DiskCallStore(home)
      await store.prune()
      writeRawState({ home, key: 'no-format', content: '{"state":"done"}' })
      writeRawState({
        home,
        key: 'future',
        content: JSON.stringify({ ...doneJournal(0), format: 2 }),
      })
      writeRawState({ home, key: 'garbage', content: '{not json' })

      expect(await store.readState({ key: 'missing' })).toBeUndefined()
      expect(await store.readState({ key: 'no-format' })).toBeUndefined()
      expect(await store.readState({ key: 'future' })).toBeUndefined()
      expect(await store.readState({ key: 'garbage' })).toBeUndefined()
    })
  })

  it('prunes entries older than the max age and keeps fresh ones', async () => {
    await withHome(async (home) => {
      const store = new DiskCallStore(home, { maxAgeMs: 60_000 })
      await store.prune()
      await seed({ store, home, key: 'stale', outputSize: 4, ageMs: 120_000 })
      await seed({ store, home, key: 'fresh', outputSize: 4, ageMs: 1_000 })

      await store.prune()

      expect(keysOf(home)).toEqual(['fresh'])
    })
  })

  it('removes the oldest entries once the byte budget is exceeded', async () => {
    await withHome(async (home) => {
      const store = new DiskCallStore(home, { maxBytes: 2_500 })
      await store.prune()
      await seed({ store, home, key: 'oldest', outputSize: 1_000, ageMs: 30_000 })
      await seed({ store, home, key: 'middle', outputSize: 1_000, ageMs: 20_000 })
      await seed({ store, home, key: 'newest', outputSize: 1_000, ageMs: 10_000 })

      await store.prune()

      expect(keysOf(home)).toEqual(['middle', 'newest'])
    })
  })

  it('keeps the newest entry even when it alone exceeds the budget', async () => {
    await withHome(async (home) => {
      const store = new DiskCallStore(home, { maxBytes: 10 })
      await store.prune()
      await seed({ store, home, key: 'older', outputSize: 1_000, ageMs: 20_000 })
      await seed({ store, home, key: 'newest', outputSize: 1_000, ageMs: 10_000 })

      await store.prune()

      expect(keysOf(home)).toEqual(['newest'])
    })
  })
})
