import { EAgentRestart, toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, test } from 'bun:test'
import React from 'react'

import { durableEntries } from '../../../store/durable-entries'
import { EEntryKind, type TranscriptEntry } from '../../../store/transcript-model'
import { log } from '../../../store/__tests__/fixture'
import { EntryView } from '../entry-view'

type Setup = Awaited<ReturnType<typeof testRender>>

const mounted: Setup[] = []

afterAll(() => {
  for (const setup of mounted) setup.renderer.destroy()
})

const childId = toThreadId('thread-child')

const agentRestarted = (over: Record<string, unknown> = {}) => ({
  type: 'agent-restarted' as const,
  agentId: childId,
  agentType: 'explore',
  intent: 'audit the credential vault',
  via: EAgentRestart.Resume,
  ...over,
})

const renderRestartRow = async (via: EAgentRestart): Promise<Setup> => {
  const entries = durableEntries({ events: log([agentRestarted({ via })]) })
  const entry = entries.find(
    (candidate: TranscriptEntry) => candidate.kind === EEntryKind.AgentRestarted,
  )
  if (entry === undefined) throw new Error('no restart entry was projected')
  const setup = await testRender(<EntryView entry={entry} width={80} />, { width: 80, height: 10 })
  mounted.push(setup)
  await setup.flush()
  return setup
}

describe('a sub-agent restart row', () => {
  test('renders its headline without claiming the child reported nothing', async () => {
    const setup = await renderRestartRow(EAgentRestart.Message)

    const frame = setup.captureCharFrame()
    expect(frame).toContain('Sub-agent explore "audit the credential vault" restarted by a message')
    expect(frame).not.toContain('reported nothing')
  })
})
