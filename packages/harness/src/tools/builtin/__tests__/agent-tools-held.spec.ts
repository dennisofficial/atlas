import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  toThreadId,
  type ThreadId,
  type ToolDefinition,
  type ToolOutcome,
} from '@dltech/atlas-core'

import {
  agentTypeNamed,
  finished,
  openSupervisor,
  settled,
} from '../../../agents/registry/__tests__/fixtures'
import type { OpenedSupervisor } from '../../../agents/registry/__tests__/fixtures'
import { AgentSayTool } from '../agent-say'
import { AgentStopTool } from '../agent-stop'

const SHELL = 'bash "bun test"'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openWithHeldChild(): Promise<{
  entry: OpenedSupervisor
  agentId: ThreadId
}> {
  const entry = await openSupervisor({
    agentTypes: [agentTypeNamed({ name: 'builder' })],
    runningShell: () => SHELL,
  })
  opened.push(entry)
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: 'builder',
    brief: 'do the work',
    intent: 'the work',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  await settled()
  entry.runners.started[0]?.settle(finished())
  await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
  return { entry, agentId: toThreadId(outcome.snapshot.agentId) }
}

const invoke = ({
  tool,
  input,
  threadId,
}: {
  tool: ToolDefinition
  input: unknown
  threadId: ThreadId
}): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: AbortSignal.timeout(10_000),
    idempotencyKey: 'key-1',
    projectDirectory: tmpdir(),
    threadId,
  })

describe('agent_say to a held child', () => {
  it('says the child is running again, since a held child restarts at once', async () => {
    const { entry, agentId } = await openWithHeldChild()

    const outcome = await invoke({
      tool: new AgentSayTool(() => entry.supervisor),
      threadId: entry.parent,
      input: { agentId, text: 'status?' },
    })

    expect(outcome.ok && outcome.modelText).toContain('running again')
    expect(outcome.ok && outcome.modelText).not.toContain('queued')
    expect(outcome.ok && outcome.output).toMatchObject({ queued: false })
  })
})

describe('agent_stop on a held child', () => {
  it('says it was idle on its shell and is being stopped, not that nothing was interrupted', async () => {
    const { entry, agentId } = await openWithHeldChild()

    const outcome = await invoke({
      tool: new AgentStopTool(() => entry.supervisor),
      threadId: entry.parent,
      input: { agentId },
    })

    const text = outcome.ok ? outcome.modelText : ''
    expect(text).toContain('idle')
    expect(text).toContain(SHELL)
    expect(text).not.toContain('step it is taking')
    expect(text).not.toContain('nothing was interrupted')
  })
})
