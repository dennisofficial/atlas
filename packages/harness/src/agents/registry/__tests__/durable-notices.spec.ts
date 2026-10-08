import { afterEach, describe, expect, it } from 'bun:test'

import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import { AgentSupervisor } from '../supervisor'
import {
  agentTypeNamed,
  finished,
  loggedOfType,
  openSupervisor,
  type OpenedSupervisor,
} from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function open(): Promise<OpenedSupervisor> {
  const entry = await openSupervisor({
    agentTypes: [agentTypeNamed({ name: 'explore' }), agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })],
  })
  opened.push(entry)
  return entry
}

async function spawn(entry: OpenedSupervisor, agentType: string): Promise<ThreadId> {
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType,
    brief: 'look',
    intent: 'looking',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

type Append = EventLogPort['append']

function interceptAppend(args: {
  entry: OpenedSupervisor
  on: (append: Append, call: Parameters<Append>[0]) => ReturnType<Append>
}): void {
  const original = args.entry.harness.log.append.bind(args.entry.harness.log)
  args.entry.harness.log.append = (call) => args.on(original, call)
}

const isNotice = (call: Parameters<Append>[0]): boolean =>
  call.drafts.some((draft) => draft.type === 'agent-reported' || draft.type === 'agent-ended')

describe('a teammate report', () => {
  it('is on the parent log before it is queued as a wake', async () => {
    const entry = await open()
    const agentId = await spawn(entry, TEAMMATE_AGENT_TYPE)
    let queuedWhenAppended: number | undefined
    interceptAppend({
      entry,
      on: (append, call) => {
        if (isNotice(call)) queuedWhenAppended = entry.supervisor.pendingNotices({ threadId: entry.parent }).length
        return append(call)
      },
    })

    const outcome = await entry.supervisor.reportToParent({ threadId: agentId, text: 'billing is migrated' })

    expect(outcome.ok).toBe(true)
    expect(queuedWhenAppended).toBe(0)
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(1)
    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-reported' })).toHaveLength(1)
  })

  it('is refused, and queues no wake, when the parent log cannot take it', async () => {
    const entry = await open()
    const agentId = await spawn(entry, TEAMMATE_AGENT_TYPE)
    interceptAppend({
      entry,
      on: (append, call) => {
        if (isNotice(call)) return Promise.reject(new Error('disk full'))
        return append(call)
      },
    })

    const outcome = await entry.supervisor.reportToParent({ threadId: agentId, text: 'billing is migrated' })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('disk full')
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-reported' })).toHaveLength(0)
  })

  it('is never appended a second time by the intake that delivers the wake', async () => {
    const entry = await open()
    const agentId = await spawn(entry, TEAMMATE_AGENT_TYPE)
    await entry.supervisor.reportToParent({ threadId: agentId, text: 'one' })
    await entry.supervisor.reportToParent({ threadId: agentId, text: 'two' })

    const batch = entry.supervisor.prepareNotifications({ threadId: entry.parent })
    expect(batch.drafts).toEqual([])
    expect(batch.wakesTurn).toBe(true)
    batch.acknowledge()

    const logged = await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-reported' })
    expect(logged.map((event) => event.prose)).toEqual(['one', 'two'])
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
  })

  it('survives a process restart as a logged event with no queue behind it', async () => {
    const entry = await open()
    const agentId = await spawn(entry, TEAMMATE_AGENT_TYPE)
    await entry.supervisor.reportToParent({ threadId: agentId, text: 'before the crash' })

    const rebuilt = new AgentSupervisor({
      log: entry.harness.log,
      threads: entry.harness.threads,
      ids: entry.harness.ids,
      clock: entry.harness.clock,
      agentTypes: [agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })],
      runners: entry.runners.source,
      launchDirectory: '/launch',
    })
    const events = await entry.harness.log.readOwn({ threadId: entry.parent })

    expect(events.some((event) => event.type === 'agent-reported' && event.prose === 'before the crash')).toBe(true)
    expect(rebuilt.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
    expect(rebuilt.prepareNotifications({ threadId: entry.parent }).drafts).toEqual([])
  })
})

describe('a child ending', () => {
  it('is on the parent log before it is queued as a wake', async () => {
    const entry = await open()
    await spawn(entry, 'explore')
    let queuedWhenAppended: number | undefined
    interceptAppend({
      entry,
      on: (append, call) => {
        if (isNotice(call)) queuedWhenAppended = entry.supervisor.pendingNotices({ threadId: entry.parent }).length
        return append(call)
      },
    })

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(queuedWhenAppended).toBe(0)
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(1)
    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })).toHaveLength(1)
  })

  it('stays owed through the intake when the first append fails, and lands exactly once', async () => {
    const entry = await open()
    await spawn(entry, 'explore')
    let failures = 1
    interceptAppend({
      entry,
      on: (append, call) => {
        if (isNotice(call) && failures-- > 0) return Promise.reject(new Error('disk full'))
        return append(call)
      },
    })

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })).toHaveLength(0)

    const batch = entry.supervisor.prepareNotifications({ threadId: entry.parent })
    expect(batch.drafts).toHaveLength(1)
    await entry.harness.log.append({
      threadId: entry.parent,
      runId: entry.harness.ids.nextRunId(),
      drafts: batch.drafts,
    })
    batch.acknowledge()

    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })).toHaveLength(1)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).drafts).toEqual([])
  })

  it('is not written again when the append landed but reported failure', async () => {
    const entry = await open()
    await spawn(entry, 'explore')
    let lied = false
    interceptAppend({
      entry,
      on: async (append, call) => {
        const written = await append(call)
        if (isNotice(call) && !lied) {
          lied = true
          throw new Error('metadata write failed')
        }
        return written
      },
    })

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(lied).toBe(true)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).drafts).toEqual([])
    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })).toHaveLength(1)
  })

  it('is cut by a rewind without coming back as a pending delivery', async () => {
    const entry = await open()
    const agentId = await spawn(entry, 'explore')
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    await entry.supervisor.removeChildren({ threadId: entry.parent, agentIds: [agentId] })

    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(false)
  })
})
