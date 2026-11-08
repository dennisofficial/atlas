import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import { CommandRows } from '../command-rows'
import { commandRowLabelOf } from '../data/command-rows'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
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
  it('names a queued command and a running one', () => {
    expect(commandRowLabelOf(row('rewind', ECommandState.Queued))).toBe('Queued: Rewind')
    expect(commandRowLabelOf(row('rewind', ECommandState.Running))).toBe('Rewinding…')
    expect(commandRowLabelOf(row('summarise', ECommandState.Running))).toBe('Summarising…')
    expect(commandRowLabelOf(row('summarise', ECommandState.Queued))).toBe('Queued: Summarise')
    expect(commandRowLabelOf(row('compact', ECommandState.Running))).toBe('Running compact…')
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
    expect(lines).toEqual(['Summarising…', 'Queued: Rewind'])
  })

  it('renders nothing without rows', async () => {
    await mount(<CommandRows rows={undefined} />)
    expect(document.body.textContent).toBe('')
  })
})
