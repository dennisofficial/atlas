import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import {
  EClientAction,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'

import { CommandListDialog } from '../command-list-dialog'

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

const entries: readonly CommandEntry[] = [
  {
    name: 'compact',
    summary: 'Compact the history',
    group: ECommandGroup.Context,
    kind: ECommandEntryKind.Command,
    source: ECommandSource.Builtin,
  },
  {
    name: 'model',
    summary: 'Pick the model',
    group: ECommandGroup.Session,
    kind: ECommandEntryKind.Command,
    source: ECommandSource.Builtin,
    opens: EClientAction.ModelPicker,
  },
  {
    name: 'review',
    summary: 'Review a change',
    group: ECommandGroup.Workspace,
    argumentHint: '<path>',
    kind: ECommandEntryKind.Skill,
    source: ECommandSource.Skill,
  },
]

const mount = async (open: boolean) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(<CommandListDialog open={open} onOpenChange={() => undefined} entries={entries} />),
  )
}

const text = (): string => document.body.textContent ?? ''

describe('CommandListDialog', () => {
  it('lists every entry of the catalogue, grouped', async () => {
    await mount(true)

    expect(text()).toContain('/compact')
    expect(text()).toContain('/model')
    expect(text()).toContain('/review')
    expect(text()).toContain('Review a change')
    expect(text()).toContain(ECommandGroup.Workspace)
  })

  it('draws nothing while closed', async () => {
    await mount(false)

    expect(text()).not.toContain('/compact')
  })
})
