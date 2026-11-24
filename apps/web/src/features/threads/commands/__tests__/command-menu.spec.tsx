import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, useState } from 'react'

import {
  EClientAction,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'

import { ThreadComposer } from '../../thread-composer'

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

const entries: CommandEntry[] = ['model', 'compact'].map((name) => ({
  name,
  summary: name,
  group: ECommandGroup.Session,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
}))

const withSkill: readonly CommandEntry[] = [
  ...entries,
  {
    name: 'review',
    summary: 'Review a change',
    group: ECommandGroup.Workspace,
    argumentHint: '<path>',
    kind: ECommandEntryKind.Skill,
    source: ECommandSource.Skill,
  },
]

const mount = async (
  log: { submits: string[]; escapes: number },
  options: {
    initial?: string
    list?: readonly CommandEntry[]
    actions?: Record<EClientAction, () => void>
  } = {},
) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const list = options.list ?? entries
  const Host = () => {
    const [value, setValue] = useState(options.initial ?? '/')
    return (
      <ThreadComposer
        value={value}
        onValueChange={setValue}
        onSubmit={(text) => void log.submits.push(text)}
        onEscape={() => void (log.escapes += 1)}
        sending={false}
        entries={list}
        {...(options.actions === undefined ? {} : { clientActions: options.actions })}
      />
    )
  }
  await act(async () => root.render(<Host />))
  const area = container.querySelector('textarea')
  if (area === null) throw new Error('no textarea')
  return area
}

const press = (area: HTMLTextAreaElement, key: string) =>
  act(async () => {
    area.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })

const actionsOf = (log: { model: number; list: number }) => ({
  [EClientAction.ModelPicker]: () => void (log.model += 1),
  [EClientAction.CommandList]: () => void (log.list += 1),
  [EClientAction.Skills]: () => undefined,
  [EClientAction.Mcp]: () => undefined,
  [EClientAction.Shells]: () => undefined,
})

describe('command menu', () => {
  it('lists commands and skills together', async () => {
    await mount({ submits: [], escapes: 0 }, { list: withSkill })

    const labels = Array.from(document.querySelectorAll('[role="option"]')).map(
      (node) => node.textContent,
    )
    expect(labels).toHaveLength(3)
    expect(labels.some((label) => label?.startsWith('/review<path>'))).toBe(true)
    expect(labels.some((label) => label?.startsWith('/model'))).toBe(true)
  })

  it('lists candidates, completes on Enter without submitting, and consumes Escape', async () => {
    const log = { submits: [] as string[], escapes: 0 }
    const area = await mount(log)
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)

    await press(area, 'ArrowDown')
    expect(area.getAttribute('aria-activedescendant')).toContain('option-1')

    await press(area, 'Enter')
    expect(log.submits).toHaveLength(0)
    expect(area.value).toBe('/compact ')
    expect(document.querySelector('[role="listbox"]')).toBeNull()

    document.body.innerHTML = ''
    const second = await mount(log)
    await press(second, 'Escape')
    expect(log.escapes).toBe(0)
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('submits on Enter when the text is an exact command name, and Tab still completes', async () => {
    const log = { submits: [] as string[], escapes: 0 }
    const area = await mount(log, { initial: '/compact' })
    await press(area, 'Tab')
    expect(area.value).toBe('/compact ')

    document.body.innerHTML = ''
    const exact = await mount(log, { initial: '/compact' })
    await press(exact, 'Enter')
    expect(log.submits).toEqual(['/compact'])
  })

  it('exposes combobox and grouped listbox semantics', async () => {
    const area = await mount({ submits: [], escapes: 0 })
    expect(area.getAttribute('role')).toBe('combobox')
    expect(area.getAttribute('aria-expanded')).toBe('true')
    expect(area.getAttribute('aria-autocomplete')).toBe('list')
    const group = document.querySelector('#command-menu fieldset')
    const label = document.getElementById(group?.getAttribute('aria-labelledby') ?? '')
    expect(label?.getAttribute('role')).toBe('presentation')
    expect(label?.textContent).toBe(ECommandGroup.Session)
  })
})

describe('client actions', () => {
  const commands: readonly CommandEntry[] = [
    {
      name: 'model',
      summary: 'Pick the model',
      group: ECommandGroup.Session,
      kind: ECommandEntryKind.Command,
      source: ECommandSource.Builtin,
      opens: EClientAction.ModelPicker,
    },
    {
      name: 'help',
      summary: 'List the commands',
      group: ECommandGroup.Session,
      kind: ECommandEntryKind.Command,
      source: ECommandSource.Builtin,
      opens: EClientAction.CommandList,
    },
  ]

  it('opens the picker for /model and posts nothing', async () => {
    const log = { submits: [] as string[], escapes: 0, model: 0, list: 0 }
    const area = await mount(log, { initial: '/model', list: commands, actions: actionsOf(log) })

    await press(area, 'Enter')

    expect(log.model).toBe(1)
    expect(log.submits).toEqual([])
    expect(area.value).toBe('')
  })

  it('opens the command list for /help and posts nothing', async () => {
    const log = { submits: [] as string[], escapes: 0, model: 0, list: 0 }
    const area = await mount(log, { initial: '/help', list: commands, actions: actionsOf(log) })

    await press(area, 'Enter')

    expect(log.list).toBe(1)
    expect(log.submits).toEqual([])
  })

  it('posts a command that runs elsewhere', async () => {
    const log = { submits: [] as string[], escapes: 0, model: 0, list: 0 }
    const area = await mount(log, {
      initial: '/rename bench',
      list: [
        {
          name: 'rename',
          summary: 'Rename this session',
          group: ECommandGroup.Session,
          kind: ECommandEntryKind.Command,
          source: ECommandSource.Builtin,
        },
      ],
      actions: actionsOf(log),
    })

    await press(area, 'Enter')

    expect(log.submits).toEqual(['/rename bench'])
    expect(log.model + log.list).toBe(0)
  })
})
