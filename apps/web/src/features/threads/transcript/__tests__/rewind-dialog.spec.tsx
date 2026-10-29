import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { RewindKillRow } from '../../data/rewind'
import { RewindDialogActions, RewindKillList } from '../rewind-dialog'

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

const kills: RewindKillRow[] = [
  { kind: 'agent', label: 'explore "vault audit"', running: true },
  { kind: 'shell', label: 'bun run dev', running: false },
]

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name,
  )

const click = (element: Element | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

describe('RewindDialog', () => {
  it('lists every kill row with its running badge', () => {
    const html = renderToStaticMarkup(<RewindKillList kills={kills} />)

    expect(html).toContain('explore &quot;vault audit&quot;')
    expect(html).toContain('bun run dev')
    expect(html.match(/Running/g)?.length).toBe(1)
  })

  it('confirms and cancels through the dialog actions', async () => {
    const calls: string[] = []
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () =>
      createRoot(container).render(
        <RewindDialogActions
          applying={false}
          onCancel={() => calls.push('cancel')}
          onConfirm={() => calls.push('confirm')}
        />,
      ),
    )

    await click(buttonNamed('Rewind'))
    await click(buttonNamed('Cancel'))

    expect(calls).toEqual(['confirm', 'cancel'])
  })

  it('disables the rewind action while applying', () => {
    const html = renderToStaticMarkup(
      <RewindDialogActions applying onCancel={() => undefined} onConfirm={() => undefined} />,
    )

    expect(html.match(/ disabled=""/g)?.length).toBe(1)
  })
})
