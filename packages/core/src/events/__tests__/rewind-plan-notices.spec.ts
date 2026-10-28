import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../agents/start'
import type { EventDraft } from '../body'
import { toThreadId } from '../ids'
import { agentEnded, arrived, delivered, shellEnded } from './notice-fixture'
import { eventsFrom, replied, said } from './rewind-fixture'
import { rewindPlan } from '../rewind-plan'

const CHILD = toThreadId('thread-child-1')

const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'audit the registry',
  mode: EAgentStart.Fresh,
}

const shellBackgrounded = (shellId: string): EventDraft => ({
  type: 'background-shell-started',
  shellId,
  command: 'npm test',
})

describe('rewindPlan with two-stage notices', () => {
  it('keeps an arrival and its delivery together when the child survives the cut', () => {
    const events = eventsFrom([
      spawned,
      said('msg_2'),
      arrived(agentEnded()),
      replied('busy'),
      delivered(agentEnded()),
    ])

    const plan = rewindPlan({ events, toSeq: 2 })

    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      arrived(agentEnded()),
      delivered(agentEnded()),
    ])
  })

  it('cuts an arrival and its delivery together when the child is cut', () => {
    const events = eventsFrom([
      said('go'),
      spawned,
      arrived(agentEnded()),
      replied('busy'),
      delivered(agentEnded()),
    ])

    expect(rewindPlan({ events, toSeq: 1 }).reappend).toEqual([])
  })

  it('keeps a delivery with its arrival when a later shell reuses the id above the cut', () => {
    const events = eventsFrom([
      shellBackgrounded('bash_1'),
      said('msg_2'),
      arrived(shellEnded),
      shellBackgrounded('bash_1'),
      delivered(shellEnded),
    ])

    const plan = rewindPlan({ events, toSeq: 2 })

    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      arrived(shellEnded),
      delivered(shellEnded),
    ])
  })

  it('cuts a delivery with its arrival when the shell that ended is cut', () => {
    const events = eventsFrom([
      said('go'),
      shellBackgrounded('bash_1'),
      arrived(shellEnded),
      shellBackgrounded('bash_1'),
      delivered(shellEnded),
    ])

    expect(rewindPlan({ events, toSeq: 1 }).reappend).toEqual([])
  })
})
