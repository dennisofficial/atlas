import { afterEach, describe, expect, it } from 'bun:test'

import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import { finished, openSupervisor, settled, type OpenedSupervisor } from './fixtures'

const opened: OpenedSupervisor[] = []

async function open(): Promise<OpenedSupervisor> {
  const entry = await openSupervisor()
  opened.push(entry)
  return entry
}

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function settledChild(entry: OpenedSupervisor) {
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: 'explore',
    brief: 'look',
    intent: 'looking',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  entry.runners.started[0]?.settle(finished())
  await settled()
  entry.supervisor.drainNotifications({ threadId: entry.parent })
  return outcome.snapshot.agentId
}

/**
 * Holds the wake's restart-record append open until the caller releases it, so an overlapping say
 * can be driven to completion inside the window the reservation exists to close. Only the
 * agent-restarted append is gated: the wake must reach it, while the say's own writes pass through.
 */
function gateRestartRecording(entry: OpenedSupervisor): { opened: Promise<void>; release: () => void } {
  const log = entry.harness.log
  const original = log.append.bind(log)
  let release: () => void = () => undefined
  let opened: () => void = () => undefined
  let gateArmed = true
  const gateOpen = new Promise<void>((resolve) => {
    opened = resolve
  })
  log.append = (async (args: Parameters<EventLogPort['append']>[0]) => {
    const restart = args.drafts.some((draft) => draft.type === 'agent-restarted')
    if (!restart || !gateArmed) return original(args)
    gateArmed = false
    opened()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return original(args)
  }) as EventLogPort['append']
  return {
    opened: gateOpen,
    release: () => release(),
  }
}

describe('waking a settled child', () => {
  it('runs one turn even when two wakes overlap the directory read', async () => {
    const entry = await open()
    const agentId = await settledChild(entry)
    const started = entry.runners.started.length

    const [first, second] = await Promise.all([
      entry.supervisor.wake({ agentId }),
      entry.supervisor.wake({ agentId }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    const refused = first.ok ? second : first
    expect(refused.ok ? '' : refused.reason).toMatch(/already taking a step/)
    expect(entry.runners.started).toHaveLength(started + 1)
  })

  it('answers for a say that started the child while the wake was recording', async () => {
    const entry = await open()
    const agentId = await settledChild(entry)
    const started = entry.runners.started.length
    const gate = gateRestartRecording(entry)

    const woken = entry.supervisor.wake({ agentId })
    await gate.opened
    const message = await entry.supervisor.say({ agentId, threadId: entry.parent, text: 'keep going' })
    expect(message.ok).toBe(true)

    gate.release()
    const wake = await woken

    expect(wake.ok).toBe(false)
    expect(wake.ok ? '' : wake.reason).toMatch(/already taking a step/)
    expect(entry.runners.started).toHaveLength(started + 1)
  })

  it('releases the reservation, so a wake after the refused one starts the child', async () => {
    const entry = await open()
    const agentId = await settledChild(entry)
    const started = entry.runners.started.length

    const [first, overlap] = await Promise.all([
      entry.supervisor.wake({ agentId }),
      entry.supervisor.wake({ agentId }),
    ])
    expect([first.ok, overlap.ok].filter(Boolean)).toHaveLength(1)

    entry.runners.started.at(-1)?.settle(finished())
    await settled()
    entry.supervisor.drainNotifications({ threadId: entry.parent })

    const again = await entry.supervisor.wake({ agentId })
    expect(again.ok).toBe(true)
    expect(entry.runners.started).toHaveLength(started + 2)
  })
})
