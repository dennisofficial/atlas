import { ETurnEndedBy, ETurnOutcome } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { closeOpenTurn } from '../orphan-turn'
import type { SessionRecord } from '../record/record-adapter'
import { ORPHAN_INTERRUPTED } from '../turn-boundary'
import { FakeLog, THREAD, depsOf, openTurnIn } from './turn-log-fixture'

describe('closeOpenTurn', () => {
  const recordOf = (log: FakeLog): SessionRecord => log as unknown as SessionRecord

  it('closes a turn left open in the log as interrupted by the host', async () => {
    const log = new FakeLog(THREAD, openTurnIn('turn-orphan'))

    await closeOpenTurn({
      deps: depsOf(),
      record: recordOf(log),
      ending: ORPHAN_INTERRUPTED,
    })

    expect(log.appended).toEqual([
      {
        type: 'turn-ended',
        turnId: 'turn-orphan',
        outcome: ETurnOutcome.Interrupted,
        by: ETurnEndedBy.Host,
      },
    ])
  })

  it('writes nothing when the log holds no open turn', async () => {
    const log = new FakeLog()

    await closeOpenTurn({ deps: depsOf(), record: recordOf(log), ending: ORPHAN_INTERRUPTED })

    expect(log.appended).toEqual([])
  })

  it('swallows a refused append', async () => {
    const log = new FakeLog(THREAD, openTurnIn('turn-orphan'))
    log.failAppend = true

    await closeOpenTurn({ deps: depsOf(), record: recordOf(log), ending: ORPHAN_INTERRUPTED })

    expect(log.appended).toEqual([])
  })
})
