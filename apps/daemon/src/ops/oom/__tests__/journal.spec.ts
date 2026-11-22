import { describe, expect, it } from 'bun:test'

import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EOomScope, type OomMemory } from '@dltech/atlas-core'
import { OOM_JOURNAL_LIMIT } from '@dltech/atlas-protocol'

import { OOM_JOURNAL_FILE, OomJournal } from '../journal'

const memory: OomMemory = { commandLimitBytes: 2_684_354_560, podBytes: 4 * 1024 ** 3 }

const withHome = async (run: (home: string) => void | Promise<void>): Promise<void> => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-oom-journal-'))
  try {
    await run(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

describe('the oom incident journal', () => {
  it('writes each incident under the daemon home and reloads it after a restart', async () => {
    await withHome((home) => {
      const journal = new OomJournal(home)
      const incident = journal.record({
        scope: EOomScope.Command,
        command: 'cargo test',
        processes: 3,
        memory,
      })
      const reloaded = new OomJournal(home)
      expect(reloaded.list()).toEqual([incident])
      expect(reloaded.count).toBe(1)
      expect(JSON.parse(readFileSync(join(home, OOM_JOURNAL_FILE), 'utf8'))).toEqual({
        total: 1,
        incidents: [incident],
      })
    })
  })

  it('keeps the last incidents and a running total across the cap', async () => {
    await withHome((home) => {
      const journal = new OomJournal(home)
      for (let index = 0; index < OOM_JOURNAL_LIMIT + 5; index++) {
        journal.record({ scope: EOomScope.Pod, processes: 1, memory })
      }
      expect(journal.list()).toHaveLength(OOM_JOURNAL_LIMIT)
      expect(journal.count).toBe(OOM_JOURNAL_LIMIT + 5)
      const reloaded = new OomJournal(home)
      expect(reloaded.list()).toHaveLength(OOM_JOURNAL_LIMIT)
      expect(reloaded.count).toBe(OOM_JOURNAL_LIMIT + 5)
    })
  })

  it('starts empty when the stored journal is unreadable', async () => {
    await withHome(async (home) => {
      await Bun.write(join(home, OOM_JOURNAL_FILE), 'not json')
      const journal = new OomJournal(home)
      expect(journal.list()).toEqual([])
      expect(journal.count).toBe(0)
    })
  })
})
