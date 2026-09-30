import { afterEach, describe, expect, it } from 'bun:test'

import { createPendingQueues } from '../../../pending'
import { MessageIntake, type IntakeDriver } from '../../../intake/message-intake'
import { operatorSource } from '../../../intake/sources'
import type { AgentType } from '../../types'
import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, finished, openSupervisor, settled, type OpenedSupervisor } from './fixtures'

const EXPLORE = agentTypeNamed({ name: 'explore' })

const flush = settled

describe('child steering through the shared intake', () => {
  const opened: OpenedSupervisor[] = []

  afterEach(async () => {
    for (const entry of opened.splice(0)) await entry.close()
  })

  it('a say that lands after the child settled restarts it and carries the message on the log', async () => {
    const entry = await openSupervisor({ agentTypes: [EXPLORE] })
    opened.push(entry)

    const spawned = await entry.supervisor.spawn({
      threadId: entry.parent,
      agentType: EXPLORE.name,
      brief: 'survey the seam',
      intent: 'survey',
    })
    if (!spawned.ok) throw new Error(spawned.reason)
    const childId = spawned.snapshot.agentId

    const run = entry.runners.started[0]
    if (run === undefined) throw new Error('the spawn never started a child runner')

    run.settle(finished())
    await flush()

    const said = await entry.supervisor.say({
      agentId: childId,
      threadId: entry.parent,
      text: 'also count the callers',
    })
    expect(said.ok).toBe(true)
    await flush()

    expect(entry.runners.started).toHaveLength(2)
    const events = await entry.harness.log.read({ threadId: childId })
    expect(events.map((event) => (event.type === 'user-said' ? event.text : event.type))).toEqual([
      'survey the seam',
      'also count the callers',
    ])
  })

  it('the prepared steering survives a failed first read, so the retry still carries it', async () => {
    const entry = await openSupervisor({ agentTypes: [EXPLORE] })
    opened.push(entry)

    const spawned = await entry.supervisor.spawn({
      threadId: entry.parent,
      agentType: EXPLORE.name,
      brief: 'survey the seam',
      intent: 'survey',
    })
    if (!spawned.ok) throw new Error(spawned.reason)
    const childId = spawned.snapshot.agentId

    const first = await entry.supervisor.say({
      agentId: childId,
      threadId: entry.parent,
      text: 'stop at the first hit',
    })
    expect(first.ok).toBe(true)

    const run = entry.runners.started[0]
    if (run === undefined) throw new Error('the spawn never started a child runner')

    const held = run.request.steering()
    expect(held.peek()).toEqual([
      { text: 'stop at the first hit', images: undefined, files: undefined },
    ])
    expect(run.request.steering().peek()).toEqual(held.peek())

    const second = await entry.supervisor.say({
      agentId: childId,
      threadId: entry.parent,
      text: 'and list the exports',
    })
    expect(second.ok).toBe(true)
    expect(run.request.steering().peek()).toEqual([
      { text: 'stop at the first hit', images: undefined, files: undefined },
      { text: 'and list the exports', images: undefined, files: undefined },
    ])

    held.acknowledge()
    expect(run.request.steering().peek()).toEqual([
      { text: 'and list the exports', images: undefined, files: undefined },
    ])
  })
})

describe('a child finish with a shared intake wired', () => {
  it('schedules a recheck, and a source that sees the ending wakes the parent driver', async () => {
    const temp = await openSupervisor({ agentTypes: [EXPLORE] })

    const { ChildSteps } = await import('../child-steps')
    const { AgentRoster } = await import('../roster')
    const { AgentNoticeQueue } = await import('../notices')
    const { freshChild } = await import('../child-state')

    const roster = new AgentRoster()
    const notices = new AgentNoticeQueue()
    const intake = new MessageIntake({
      sources: [
        {
          threadsAwaitingInput: () => notices.threadsQueued(),
          subscribe: (listener) => notices.onNotice(listener),
          prepare: () => ({ drafts: [], wakesTurn: false, acknowledge: () => undefined }),
        },
      ],
    })
    let wakes = 0
    const driver: IntakeDriver = {
      blocked: () => false,
      wake: () => {
        wakes += 1
      },
    }
    intake.register({ threadId: temp.parent, driver })

    try {
      const steps = new ChildSteps({
        runners: temp.runners.source,
        roster,
        notices,
        clock: temp.harness.clock,
        intake,
      })

      const agentType: AgentType = EXPLORE
      const child = freshChild({
        agentId: temp.parent,
        spawnedBy: temp.parent,
        agentType: agentType.name,
        intent: 'survey',
        at: temp.harness.clock.now(),
        projectDirectory: undefined,
      })
      roster.add(child)

      steps.take({
        child,
        agentType,
        step: async () => finished(),
      })
      await steps.whenSettled()
      await flush()
      await flush()

      expect(child.status).not.toBe('running')
      expect(notices.pending({ threadId: temp.parent })).toHaveLength(1)
      expect(wakes).toBeGreaterThan(0)
    } finally {
      intake.dispose()
      await temp.close()
    }
  })

  it('a steer to a running child rides the shared intake queue; one to a settled child restarts it', async () => {
    const temp = await openSupervisor({ agentTypes: [EXPLORE] })
    const pending = createPendingQueues()
    const intake = new MessageIntake({
      sources: [operatorSource(pending)],
      submit: (args) =>
        pending.forThread({ threadId: args.threadId }).enqueue(args),
    })

    const supervisor = new AgentSupervisor({
      log: temp.harness.log,
      threads: temp.harness.threads,
      ids: temp.harness.ids,
      clock: temp.harness.clock,
      agentTypes: [EXPLORE],
      runners: temp.runners.source,
      launchDirectory: '/launch',
      input: () => intake,
    })

    try {
      const spawned = await supervisor.spawn({
        threadId: temp.parent,
        agentType: EXPLORE.name,
        brief: 'survey the seam',
        intent: 'survey',
      })
      if (!spawned.ok) throw new Error(spawned.reason)
      const childId = spawned.snapshot.agentId

      const run = temp.runners.started[0]
      if (run === undefined) throw new Error('the spawn never started a child runner')

      const steered = await supervisor.say({
        agentId: childId,
        threadId: temp.parent,
        text: 'while you run',
      })
      expect(steered.ok).toBe(true)
      expect(pending.forThread({ threadId: childId }).getSnapshot()).toHaveLength(1)

      run.settle(finished())
      await supervisor.whenChildrenSettled({ threadId: temp.parent })
      await settled()

      const said = await supervisor.say({
        agentId: childId,
        threadId: temp.parent,
        text: 'after you settled',
      })
      expect(said.ok).toBe(true)
      await settled()

      expect(temp.runners.started).toHaveLength(2)
      const events = await temp.harness.log.read({ threadId: childId })
      const saidTexts = events.flatMap((event) => event.type === 'user-said' ? [event.text] : [])
      expect(saidTexts).toContain('after you settled')
    } finally {
      intake.dispose()
      await temp.close()
    }
  })
})
