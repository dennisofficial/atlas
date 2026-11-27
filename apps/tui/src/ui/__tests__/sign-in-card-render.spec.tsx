import { testRender } from '@opentui/react/test-utils'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import type { SignInEntry } from '@dltech/atlas-client/transcript'
import { EReturnResult } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { EAuthor, EEntryKind } from '../../store'
import { EntryView } from '../components/entry-view'
import { teardown } from '../markdown/__tests__/harness'

const WIDE = { width: 120, height: 20 }

const card = (state: string, over: Partial<SignInEntry> = {}): SignInEntry => ({
  kind: EEntryKind.SignIn,
  author: EAuthor.Model,
  key: `sign-in:${state}`,
  text: 'sign in to the linear MCP server',
  subject: 'linear',
  url: `https://atlas.example/return/start/${state}`,
  ...over,
})

async function shown(node: React.ReactNode): Promise<string> {
  const setup = await testRender(<box flexDirection="column">{node}</box>, WIDE)
  try {
    await setup.flush()
    return setup.captureCharFrame()
  } finally {
    await teardown(setup)
  }
}

describe('an MCP sign-in card', () => {
  it('asks for the sign-in while nothing has answered yet', async () => {
    const frame = await shown(<EntryView entry={card('state-pending')} width={110} />)

    expect(frame).toContain('linear needs a sign-in')
    expect(frame).toContain('Sign in')
    expect(frame).not.toContain('Try again')
  })

  it('shows the durable result the roster already knows', async () => {
    const frame = await shown(
      <EntryView
        entry={card('state-connected', { result: 'connected' })}
        width={110}
        onRetrySignIn={() => undefined}
      />,
    )

    expect(frame).toContain('Signed in to linear')
    expect(frame).not.toContain('Try again')
  })

  it('shows the reason a refused sign-in carries, with Try again beside it', async () => {
    const frame = await shown(
      <EntryView
        entry={card('state-refused', { result: 'failed', reason: 'the provider refused' })}
        width={110}
        onRetrySignIn={() => undefined}
      />,
    )

    expect(frame).toContain('Could not sign in to linear')
    expect(frame).toContain('the provider refused')
    expect(frame).toContain('Try again')
  })

  it('takes a result the framework delivered for this very card', async () => {
    browserReturns.remember({
      state: 'state-local',
      outcome: { result: EReturnResult.Connected },
    })

    const frame = await shown(<EntryView entry={card('state-local')} width={110} />)

    expect(frame).toContain('Signed in to linear')
  })

  it('ignores a result that belongs to another card', async () => {
    browserReturns.remember({
      state: 'state-somebody-else',
      outcome: { result: EReturnResult.Connected },
    })

    const frame = await shown(<EntryView entry={card('state-own')} width={110} />)

    expect(frame).toContain('linear needs a sign-in')
  })

  it('sends the retry for the server when Try again is clicked', async () => {
    const asked: string[] = []
    const setup = await testRender(
      <box flexDirection="column">
        <EntryView
          entry={card('state-retry', { result: 'failed', reason: 'the provider refused' })}
          width={110}
          onRetrySignIn={(server) => asked.push(server)}
        />
      </box>,
      WIDE,
    )
    try {
      await setup.flush()
      const rows = setup.captureCharFrame().split('\n')
      const row = rows.findIndex((line) => line.includes('Try again'))
      expect(row).toBeGreaterThanOrEqual(0)
      const column = (rows[row] ?? '').indexOf('Try again')

      await setup.mockMouse.click(column + 1, row)

      expect(asked).toEqual(['linear'])
    } finally {
      await teardown(setup)
    }
  })
})
