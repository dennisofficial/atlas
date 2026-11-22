import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import { CommandRows } from '../command-rows'
import { commandRowLabelOf, humanizedCommandName } from '../data/command-rows'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
}

const row = (name: string, state: ECommandState, inboxId = 1): SessionCommandRow => ({
  inboxId,
  name,
  state,
  postedAt: '2026-11-08T10:00:00.000Z',
})

describe('commandRowLabelOf', () => {
  it('says a settled command waits for the turn, and names it while running', () => {
    expect(commandRowLabelOf(row('summarise', ECommandState.Queued))).toBe(
      'Summarise after this turn',
    )
    expect(commandRowLabelOf(row('rewind', ECommandState.Queued))).toBe('Rewind after this turn')
    expect(commandRowLabelOf(row('summarise', ECommandState.Running))).toBe('Summarising…')
    expect(commandRowLabelOf(row('rewind', ECommandState.Running))).toBe('Rewinding…')
  })

  it('never shows a raw command name', () => {
    expect(commandRowLabelOf(row('compact', ECommandState.Running))).toBe('Running Compact…')
    expect(commandRowLabelOf(row('foo-bar', ECommandState.Queued))).toBe('Running Foo bar…')
    expect(humanizedCommandName('set-subscription-status')).toBe('Set subscription status')
  })

  it('has no queued wording left', () => {
    expect(commandRowLabelOf(row('rewind', ECommandState.Queued))).not.toContain('Queued')
  })
})

describe('CommandRows', () => {
  it('renders one status line per row', async () => {
    await mount(
      <CommandRows
        rows={[row('summarise', ECommandState.Running, 1), row('rewind', ECommandState.Queued, 2)]}
      />,
    )
    const lines = Array.from(document.body.querySelectorAll('[role="status"]')).map(
      (node) => node.textContent,
    )
    expect(lines).toEqual(['Summarising…', 'Rewind after this turn'])
  })

  it('renders nothing without rows', async () => {
    await mount(<CommandRows rows={undefined} />)
    expect(document.body.textContent).toBe('')
  })
})
