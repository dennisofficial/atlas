import { describe, expect, it } from 'bun:test'

import { agentRoster, unendedSpawns } from '../../agents/roster'
import { EAgentStart } from '../../agents/start'
import { fixtureThreadId, log } from '../../assembly/__tests__/log-fixture'
import { ELifecycleState } from '../../lifecycle/lifecycle'
import { servicesLifecycle } from '../../services/pairing'
import { endedShellKeysOf, EShellLifecycleState, shellsLifecycle } from '../../shells/lifecycle'
import type { EventDraft } from '../body'
import { shellCompletionNudge } from '../shell-completion-nudge'
import { liveOwnedUnits } from '../ownership'
import { loopWatchWindow } from '../loop-watch'
import { transcriptOfRange } from '../../compaction/render-range'
import { agentEnded, arrived, CHILD, delivered, serviceEnded, shellEnded } from './notice-fixture'

const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'audit the registry',
  mode: EAgentStart.Fresh,
}
const shellStarted: EventDraft = {
  type: 'background-shell-started',
  shellId: 'bash_1',
  command: 'npm test',
}
const serviceStarted: EventDraft = {
  type: 'service-started',
  serviceId: 'svc_1',
  command: 'npm run dev',
}

describe('one ending recorded as an arrival and a delivery', () => {
  it('counts one agent ending in the roster, from the arrival', () => {
    const events = log([
      spawned,
      arrived(agentEnded({ turns: 2 })),
      delivered(agentEnded({ turns: 9 })),
    ])

    const [agent] = agentRoster({ events, threadId: fixtureThreadId })

    expect(agent?.turns).toBe(2)
    expect(agent?.endedAt).toBeDefined()
    expect(unendedSpawns(events)).toEqual([])
  })

  it('does not let a delivery alone settle a spawn', () => {
    const events = log([spawned, delivered(agentEnded())])

    expect(unendedSpawns(events)).toHaveLength(1)
  })

  it('settles one shell and leaves the next occurrence open', () => {
    const events = log([shellStarted, shellStarted, arrived(shellEnded), delivered(shellEnded)])

    expect(shellsLifecycle(events).map((shell) => shell.state)).toEqual([
      EShellLifecycleState.Settled,
      EShellLifecycleState.Lost,
    ])
    expect(endedShellKeysOf(events).size).toBe(1)
  })

  it('settles one service and leaves the next occurrence open', () => {
    const events = log([
      serviceStarted,
      serviceStarted,
      arrived(serviceEnded),
      delivered(serviceEnded),
    ])

    expect(servicesLifecycle(events).map((service) => service.state)).toEqual([
      ELifecycleState.Settled,
      ELifecycleState.Lost,
    ])
  })

  it('releases ownership on the arrival and ignores the delivery', () => {
    const events = log([
      shellStarted,
      serviceStarted,
      spawned,
      arrived(shellEnded),
      arrived(serviceEnded),
      arrived(agentEnded()),
      delivered(shellEnded),
    ])

    expect(liveOwnedUnits(events)).toEqual({ shells: [], services: [], agents: [] })
  })

  it('keeps a shell owned when only a delivery names its ending', () => {
    const units = liveOwnedUnits(log([shellStarted, delivered(shellEnded)]))

    expect(units.shells).toHaveLength(1)
  })
})

describe('what the model-side readers take from an arrival', () => {
  it('leaves an arrival out of the compaction transcript and keeps the delivery', () => {
    const events = log([arrived(shellEnded), arrived(agentEnded()), delivered(shellEnded)])

    const transcript = transcriptOfRange({ events, throughSeq: 3 })

    expect(transcript.split('\n')).toHaveLength(1)
    expect(transcript).toContain('Background shell "npm test"')
  })

  it('leaves an arrival out of the loop-watch window', () => {
    const speech = (text: string): EventDraft => ({
      type: 'assistant-said',
      parts: [{ type: 'text', text }],
    })
    const events = log([
      speech('one'),
      arrived(shellEnded),
      speech('two'),
      delivered(serviceEnded),
      speech('three'),
    ])

    const steps = loopWatchWindow({ events })

    expect(steps?.map((step) => step.seq)).toEqual([1, 3, 4, 5])
  })

  it('does not nudge for a shell ending that only arrived', () => {
    const events = log([
      { type: 'user-said', text: 'run it' },
      arrived(shellEnded),
      { type: 'assistant-said', parts: [{ type: 'text', text: 'waiting' }] },
    ])

    expect(shellCompletionNudge({ events, seenThrough: 1 })).toBeUndefined()
  })

  it('nudges for a delivered shell ending the reply missed', () => {
    const events = log([
      { type: 'user-said', text: 'run it' },
      delivered(shellEnded),
      { type: 'assistant-said', parts: [{ type: 'text', text: 'waiting' }] },
    ])

    expect(shellCompletionNudge({ events, seenThrough: 1 })).toMatchObject({ type: 'nudge' })
  })
})
