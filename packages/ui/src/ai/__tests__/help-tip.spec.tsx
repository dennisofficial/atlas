import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import type { ReactElement } from 'react'
import { act } from 'react'

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { HelpTip } = await import('../help-tip')

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: { render: (node: ReactElement) => void; unmount: () => void } | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function mount(element: ReactElement) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
}

const TIP = 'Plans the work, edits code, and talks to you in the thread.'

const triggerOf = () => document.body.querySelector<HTMLButtonElement>('button[aria-label]')

describe('HelpTip', () => {
  it('names the trigger after the thing it explains', async () => {
    await mount(<HelpTip label="Main agent">{TIP}</HelpTip>)

    expect(triggerOf()?.getAttribute('aria-label')).toBe('About Main agent')
  })

  it('keeps the tip closed until asked', async () => {
    await mount(<HelpTip label="Main agent">{TIP}</HelpTip>)

    expect(document.body.textContent).not.toContain(TIP)
  })

  it('opens the tip on a click', async () => {
    await mount(<HelpTip label="Main agent">{TIP}</HelpTip>)

    await act(async () => triggerOf()?.click())

    expect(document.body.textContent).toContain(TIP)
  })

  it('opens the tip on keyboard focus', async () => {
    await mount(<HelpTip label="Main agent">{TIP}</HelpTip>)

    await act(async () => triggerOf()?.focus())

    expect(document.body.textContent).toContain(TIP)
  })

  it('closes the tip when the trigger loses focus', async () => {
    await mount(<HelpTip label="Main agent">{TIP}</HelpTip>)
    await act(async () => triggerOf()?.focus())

    await act(async () => triggerOf()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

    expect(document.body.textContent).not.toContain(TIP)
  })
})
