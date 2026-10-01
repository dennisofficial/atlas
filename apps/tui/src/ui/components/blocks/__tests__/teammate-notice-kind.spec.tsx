import { describe, expect, it } from 'bun:test'
import { EAgentStatus, toThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { durableEntries } from '../../../../store/durable-entries'
import { EEntryKind } from '../../../../store/transcript-model'
import { log } from '../../../../store/__tests__/fixture'
import { EntryView } from '../../entry-view'

const CHILD = toThreadId('teammate')

describe('a teammate ending relays like any other', () => {
  it('labels the ending as a report like a sub-agent ending', async () => {
    const [entry] = durableEntries({ events: log([{
      type: 'agent-ended', agentId: CHILD, agentType: 'teammate', intent: 'inspect serve',
      status: EAgentStatus.Finished, prose: 'Done. Report delivered earlier.', turns: 9, toolCalls: 7,
    }]) })
    if (entry === undefined || entry.kind !== EEntryKind.AgentEnded) throw new Error('missing ending')
    const setup = await testRender(<EntryView entry={entry} width={150} />, { width: 160, height: 10 })
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('↵ report')
      expect(frame).not.toContain('no wake')
    } finally {
      setup.renderer.destroy()
    }
  })

  it('keeps an explicit report labelled as a report', async () => {
    const [entry] = durableEntries({ events: log([{
      type: 'agent-reported', agentId: CHILD, agentType: 'teammate', intent: 'inspect serve', prose: 'Here is the synthesis.',
    }]) })
    if (entry === undefined) throw new Error('missing report')
    const setup = await testRender(<EntryView entry={entry} width={150} expanded={false} />, { width: 160, height: 10 })
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('reported')
      expect(frame).toContain('↵ report')
      expect(frame).not.toContain('no wake')
    } finally {
      setup.renderer.destroy()
    }
  })
})
