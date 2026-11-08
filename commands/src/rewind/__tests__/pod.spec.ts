import { describe, expect, it } from 'bun:test'
import type { EventDraft, RecordBody } from '@dltech/atlas-core'

import { rewindHandler } from '../pod'
import { REFUSAL_NOT_A_MESSAGE } from '../spec'
import { eventsFrom, replied, said } from './fixture'

const run = async (toSeq: number) => {
  const appended: (EventDraft | RecordBody)[] = []
  const result = await rewindHandler({
    args: { toSeq },
    sessionId: 's1',
    visibleEvents: () =>
      eventsFrom([said('first'), replied('one'), said('second'), replied('two')]),
    append: async (drafts) => {
      appended.push(...drafts)
    },
    log: () => undefined,
  })
  return { appended, result }
}

describe('rewindHandler', () => {
  it('hides the picked message onward and keeps its text as the draft', async () => {
    const { appended, result } = await run(3)
    expect(result).toEqual({ kind: 'done' })
    expect(appended).toEqual([{ type: 'history-rewound', toSeq: 2, draft: 'second' }])
  })

  it('refuses without appending when the target is not a message', async () => {
    const { appended, result } = await run(2)
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_NOT_A_MESSAGE })
    expect(appended).toEqual([])
  })
})
