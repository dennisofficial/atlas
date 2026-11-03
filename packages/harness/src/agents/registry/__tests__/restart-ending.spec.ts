import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, type ThreadId } from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import {
  agentTypeNamed,
  failed,
  finished,
  loggedOfType,
  openSupervisor,
  said,
  type OpenedSupervisor,
} from './fixtures'

const CLOUD_401 = 'CloudError: The Atlas Cloud API answered 401: a valid session is required.'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const openWithTeammate = async (): Promise<OpenedSupervisor & { teammate: ThreadId }> => {
  const entry = await openSupervisor({
    agentTypes: [agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })],
  })
  opened.push(entry)
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: TEAMMATE_AGENT_TYPE,
    brief: 'review the automations',
    intent: 'review the automations',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return { ...entry, teammate: outcome.snapshot.agentId }
}

const endingsOf = async (entry: OpenedSupervisor) =>
  (
    await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })
  ).filter((ending) => ending.notice === undefined || ending.notice.stage === 'arrived')

describe('the ending of a restarted run', () => {
  it('carries only what that run said and the cause it died on', async () => {
    const entry = await openWithTeammate()
    const first = entry.runners.started[0]
    first?.observe(said('The builder is running again after the session restart.'))
    first?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const restarted = await entry.supervisor.say({
      agentId: entry.teammate,
      threadId: entry.parent,
      text: 'the base is current, carry on',
    })
    expect(restarted.ok).toBe(true)
    entry.runners.started[1]?.settle(failed(CLOUD_401))
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const failure = (await endingsOf(entry)).find((one) => one.status === EAgentStatus.Failed)
    expect(failure?.failureCause).toBe(CLOUD_401)
    expect(failure?.prose).not.toContain('running again')
  })

  it('does not carry a previous run failure into a later clean finish', async () => {
    const entry = await openWithTeammate()
    entry.runners.started[0]?.settle(failed(CLOUD_401))
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    await entry.supervisor.say({ agentId: entry.teammate, threadId: entry.parent, text: 'retry' })
    const second = entry.runners.started[1]
    second?.observe(said('Slice 07b is built.'))
    second?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const endings = await endingsOf(entry)
    const finish = endings.findLast((one) => one.status === EAgentStatus.Finished)
    expect(finish?.prose).toBe('Slice 07b is built.')
    expect(finish?.failureCause).toBeUndefined()
    expect(finish?.failureKind).toBeUndefined()
    const snapshot = entry.supervisor.list({ threadId: entry.parent })[0]
    expect(snapshot?.failureCause).toBeUndefined()
  })
})
