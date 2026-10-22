import { describe, expect, it } from 'bun:test'

import { EJournalSkip } from '../journal'
import {
  deltaOf,
  openJournal,
  OTHER_SHELL,
  SHELL,
  snapshotOf,
  THREAD,
} from './journal-fixture'

const matchedArgs = {
  threadId: THREAD,
  shellId: SHELL,
  snapshot: snapshotOf(),
  pattern: 'ready',
  matched: { lines: ['ready one', 'ready two'], matchCount: 2, disarmed: true },
}

const endedArgs = {
  threadId: THREAD,
  shellId: SHELL,
  snapshot: snapshotOf(),
  delta: deltaOf(),
  hooked: [],
}

describe('the shell event journal', () => {
  it('lands one shell’s events in enqueue order when the callers race', async () => {
    const { journal, log } = openJournal()
    log.autoSettle = false

    const matched = journal.matched(matchedArgs)
    const ended = journal.ended(endedArgs)
    await Bun.sleep(0)

    expect(log.calls).toHaveLength(1)
    log.calls[0]?.settle.release()
    await Bun.sleep(0)
    expect(log.calls).toHaveLength(2)
    log.calls[1]?.settle.release()

    expect(await Promise.all([matched, ended])).toEqual([{ appended: true }, { appended: true }])
    expect(log.landedTypes()).toEqual(['background-shell-matched', 'background-shell-ended'])
  })

  it('does not serialize different shells against each other', async () => {
    const { journal, log } = openJournal()
    log.autoSettle = false

    const first = journal.matched(matchedArgs)
    const second = journal.matched({ ...matchedArgs, shellId: OTHER_SHELL })
    await Bun.sleep(0)

    expect(log.calls).toHaveLength(2)
    log.calls[1]?.settle.release()
    await second
    expect(log.landed).toHaveLength(1)
    log.calls[0]?.settle.release()
    await first
    expect(log.landed).toHaveLength(2)
  })

  it('does not serialize the same shell id across threads', async () => {
    const { journal, log } = openJournal()
    log.autoSettle = false

    const first = journal.matched(matchedArgs)
    const second = journal.matched({ ...matchedArgs, threadId: `${THREAD}-b` as typeof THREAD })
    await Bun.sleep(0)

    expect(log.calls).toHaveLength(2)
    log.calls.forEach((call) => call.settle.release())
    await Promise.all([first, second])
  })

  it('carries the hooked drafts in the same append call as the ended draft', async () => {
    const { journal, log } = openJournal()
    const hooked = [{ type: 'context-loaded' as const, slot: 'after-shell', key: 'test', content: 'done' }]

    await journal.ended({ ...endedArgs, hooked })

    expect(log.calls).toHaveLength(1)
    expect(log.calls[0]?.drafts.map((draft) => draft.type)).toEqual([
      'background-shell-ended',
      'context-loaded',
    ])
  })

  it('resolves an ended append only once the log has made it durable', async () => {
    const { journal, log } = openJournal()
    log.autoSettle = false
    let resolved = false

    const ended = journal.ended(endedArgs).then((result) => {
      resolved = true
      return result
    })
    await Bun.sleep(0)
    expect(resolved).toBe(false)

    log.calls[0]?.settle.release()
    expect(await ended).toEqual({ appended: true })
  })

  it('warns, drops the fact and keeps the chain going when an append fails', async () => {
    const { journal, log, warnings } = openJournal()
    log.failNext = new Error('disk full')

    const lost = await journal.matched(matchedArgs)
    const next = await journal.ended(endedArgs)

    expect(lost).toEqual({ appended: false, reason: EJournalSkip.Failed })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('disk full')
    expect(next).toEqual({ appended: true })
    expect(log.landedTypes()).toEqual(['background-shell-ended'])
  })

  it('waits for in-flight appends on disown, then supersedes every later one', async () => {
    const { journal, log } = openJournal()
    log.autoSettle = false

    const inFlight = journal.matched(matchedArgs)
    await Bun.sleep(0)
    let quiesced = false
    const disowned = journal.disown({ threadId: THREAD, shellId: SHELL }).then(() => {
      quiesced = true
    })
    await Bun.sleep(0)
    expect(quiesced).toBe(false)

    log.calls[0]?.settle.release()
    await disowned
    expect(await inFlight).toEqual({ appended: true })

    const late = await journal.ended(endedArgs)
    expect(late).toEqual({ appended: false, reason: EJournalSkip.Superseded })
    expect(log.calls).toHaveLength(1)
  })

  it('resolves disown at once for a shell with nothing in flight', async () => {
    const { journal, log } = openJournal()

    await journal.disown({ threadId: THREAD, shellId: SHELL })

    expect(await journal.started({ threadId: THREAD, shellId: SHELL, snapshot: snapshotOf() })).toEqual({
      appended: false,
      reason: EJournalSkip.Superseded,
    })
    expect(log.calls).toHaveLength(0)
  })

  it('leaves other shells writable after one is disowned', async () => {
    const { journal, log } = openJournal()

    await journal.disown({ threadId: THREAD, shellId: SHELL })
    const other = await journal.ended({ ...endedArgs, shellId: OTHER_SHELL })

    expect(other).toEqual({ appended: true })
    expect(log.landed).toHaveLength(1)
  })

  it('builds the started, matched and awaiting-input drafts the log schemas expect', async () => {
    const { journal, log } = openJournal()
    const snapshot = snapshotOf()

    await journal.started({ threadId: THREAD, shellId: SHELL, snapshot })
    await journal.matched(matchedArgs)
    await journal.awaitingInput({
      threadId: THREAD,
      shellId: SHELL,
      snapshot,
      delta: deltaOf({ text: 'Password:', remainingCharacters: 3 }),
    })

    expect(log.landed.flat()).toEqual([
      {
        type: 'background-shell-started',
        shellId: SHELL,
        command: 'sleep 1',
        description: 'sleeps',
        bootId: 'boot-1',
      },
      {
        type: 'background-shell-matched',
        shellId: SHELL,
        bootId: 'boot-1',
        command: 'sleep 1',
        description: 'sleeps',
        pattern: 'ready',
        lines: 'ready one\nready two',
        matchCount: 2,
        watchDisarmed: true,
      },
      {
        type: 'background-shell-awaiting-input',
        shellId: SHELL,
        bootId: 'boot-1',
        command: 'sleep 1',
        description: 'sleeps',
        output: 'Password:',
        droppedCharacters: 0,
        remainingCharacters: 3,
      },
    ])
  })

  it('refuses progress and duplicate endings after an ending was enqueued', async () => {
    const { journal, log } = openJournal()
    const ending = journal.ended(endedArgs)
    expect(await journal.matched(matchedArgs)).toEqual({ appended: false, reason: EJournalSkip.Ended })
    expect(await journal.ended(endedArgs)).toEqual({ appended: false, reason: EJournalSkip.Ended })
    await ending
    expect(log.landedTypes()).toEqual(['background-shell-ended'])
  })

  it('retries a failed ending without admitting late progress or duplicate successful endings', async () => {
    const { journal, log } = openJournal()
    log.failNext = new Error('disk full')
    expect(await journal.ended(endedArgs)).toEqual({ appended: false, reason: EJournalSkip.Failed })
    expect(await journal.matched(matchedArgs)).toEqual({ appended: false, reason: EJournalSkip.Ended })
    expect(await journal.ended(endedArgs)).toEqual({ appended: true })
    expect(await journal.ended(endedArgs)).toEqual({ appended: false, reason: EJournalSkip.Ended })
    expect(log.landedTypes()).toEqual(['background-shell-ended'])
  })

  it('drops queued writes after disown and waits for the in-flight write', async () => {
    const { journal, log } = openJournal()
    log.autoSettle = false
    const first = journal.matched(matchedArgs)
    const queued = journal.awaitingInput({ ...matchedArgs, delta: deltaOf() })
    await Bun.sleep(0)
    const removed = journal.disown({ threadId: THREAD, shellId: SHELL })
    log.calls[0]?.settle.release()
    await removed
    expect(await first).toEqual({ appended: true })
    expect(await queued).toEqual({ appended: false, reason: EJournalSkip.Superseded })
    expect(log.calls).toHaveLength(1)
  })

  it('leaves watchDisarmed unset when the watch is still armed', async () => {
    const { journal, log } = openJournal()

    await journal.matched({
      ...matchedArgs,
      matched: { lines: ['ready'], matchCount: 1, disarmed: false },
    })

    expect(log.landed[0]?.[0]).toMatchObject({ watchDisarmed: undefined, matchCount: 1 })
  })
})
