import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ENoticeTone, HarnessNotice } from '../harness-notice'

describe('HarnessNotice', () => {
  it('shows the empty note inline and no expander when there is no body', () => {
    const html = renderToStaticMarkup(
      <HarnessNotice title="PR #1: merged" tone={ENoticeTone.Ok} body="" emptyNote="no body" />,
    )

    expect(html).toContain('no body')
    expect(html).not.toContain('trace-collapsible-trigger')
  })

  it('offers an expander and hides the empty note when there is a body', () => {
    const html = renderToStaticMarkup(
      <HarnessNotice
        title="exited"
        tone={ENoticeTone.Failed}
        body="boom"
        emptyNote="printed nothing"
      />,
    )

    expect(html).toContain('trace-collapsible-trigger')
    expect(html).not.toContain('printed nothing')
  })

  it('draws a single section as the notice itself, not a nested row', () => {
    const label = 'skill suggestion, ui-design'
    const html = renderToStaticMarkup(
      <HarnessNotice
        title={label}
        tone={ENoticeTone.Quiet}
        sections={[{ id: 'a', label, content: 'SKILL BODY', note: 'superseded' }]}
      />,
    )

    expect(html.split(label)).toHaveLength(2)
    expect(html.split('data-slot="trace-collapsible-trigger"')).toHaveLength(2)
    expect(html).toContain('superseded')
  })

  it('keeps the group summary when there are several sections', () => {
    const html = renderToStaticMarkup(
      <HarnessNotice
        title="2 prompts"
        tone={ENoticeTone.Quiet}
        sections={[
          { id: 'a', label: 'memory', content: 'A' },
          { id: 'b', label: 'skill listing', content: 'B' },
        ]}
      />,
    )

    expect(html).toContain('2 prompts')
    expect(html).toContain('data-slot="trace-collapsible-trigger"')
  })
})

describe('HarnessNotice action', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  it('renders the action button and calls it when pressed', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    let presses = 0
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <HarnessNotice
          title="ran out of memory"
          tone={ENoticeTone.Failed}
          action={{ label: 'Change pod size', onClick: () => (presses += 1) }}
        />,
      ),
    )
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Change pod size',
    )
    expect(button).toBeDefined()
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(presses).toBe(1)
    await act(async () => root.unmount())
    container.remove()
  })

  it('draws no button without an action', () => {
    const html = renderToStaticMarkup(
      <HarnessNotice title="ran out of memory" tone={ENoticeTone.Failed} />,
    )
    expect(html).not.toContain('Change pod size')
  })
})
