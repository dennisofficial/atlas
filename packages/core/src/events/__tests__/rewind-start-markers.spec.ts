import { describe, expect, it } from 'bun:test'

import { rewindPlan } from '../rewind-plan'
import {
  backgrounded,
  eventsFrom,
  replied,
  said,
  shellCutIds,
  shellEnded,
  shellStarted,
  startedInBackground,
} from './rewind-fixture'

describe('rewindPlan for background shell start markers', () => {
  it('cuts a shell by its started event, the marker modern shells write at occurrence', () => {
    const events = eventsFrom([
      said('msg_1'),
      shellStarted('bash_1'),
      replied('on it'),
      said('msg_2'),
      shellEnded({ shellId: 'bash_1', output: 'all green' }),
      said('msg_3'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(shellCutIds(plan)).toEqual(['bash_1'])
    expect(plan.cuts[0]).toMatchObject({
      kind: 'shell',
      shellId: 'bash_1',
      command: 'npm test',
      description: 'run the tests',
    })
    expect(plan.reappend).toEqual([])
  })

  it('keeps a shell whose started event sits below the cut', () => {
    const events = eventsFrom([
      said('msg_1'),
      shellStarted('bash_1'),
      said('msg_2'),
      shellEnded({ shellId: 'bash_1', output: 'all green' }),
      said('msg_3'),
    ])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      expect.objectContaining({ shellId: 'bash_1' }),
    ])
  })

  it('cuts a shell once when the log carries both the started event and the tool-call pairing', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedInBackground('call-1'),
      backgrounded({ callId: 'call-1', shellId: 'bash_1' }),
      shellStarted('bash_1'),
      said('msg_2'),
      shellEnded({ shellId: 'bash_1', output: 'all green' }),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(shellCutIds(plan)).toEqual(['bash_1'])
  })
})
