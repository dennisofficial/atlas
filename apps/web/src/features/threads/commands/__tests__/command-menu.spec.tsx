import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act, useState } from 'react'

import { ECommandGroup, ECommandKind, type CommandSpec } from '@dltech/atlas-core'

import { ThreadComposer } from '../../thread-composer'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const specs: CommandSpec[] = ['model', 'compact'].map((name) => ({
  name,
  kind: ECommandKind.Local,
  summary: name,
  group: ECommandGroup.Session,
}))

const mount = async (log: { submits: string[]; escapes: number }, initial = '/') => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const Host = () => {
    const [value, setValue] = useState(initial)
    return (
      <ThreadComposer
        value={value}
        onValueChange={setValue}
        onSubmit={(text) => void log.submits.push(text)}
        onEscape={() => void (log.escapes += 1)}
        sending={false}
        commandSpecs={specs}
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

describe('command menu', () => {
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
    const area = await mount(log, '/compact')
    await press(area, 'Tab')
    expect(area.value).toBe('/compact ')

    document.body.innerHTML = ''
    const exact = await mount(log, '/compact')
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
