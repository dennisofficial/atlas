import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DiagramError } from '../diagram-error'
import { summarizeDiagramError } from '../internal/diagram-error-summary'

const CHART = 'flowchart LR\n  A[Start --> B{Check'
const ERROR =
  "Parse error on line 2:\n...A[Start --> B{Check\n---^\nExpecting 'SQE', 'PE', got 'DIAMOND_START'"

describe('summarizeDiagramError', () => {
  it('keeps the text before the token list', () => {
    expect(
      summarizeDiagramError({
        error: "Parse error on line 2: Expecting 'SQE', got 'X'",
      }),
    ).toBe('Parse error on line 2:')
  })

  it('uses the first line only', () => {
    expect(summarizeDiagramError({ error: 'Parse error on line 2:\n...A[Start' })).toBe(
      'Parse error on line 2:',
    )
  })

  it('caps a long message at 160 characters', () => {
    expect(summarizeDiagramError({ error: 'x'.repeat(400) })).toHaveLength(160)
  })

  it('falls back to the raw text when the message starts with the token list', () => {
    expect(summarizeDiagramError({ error: "Expecting 'SQE'" })).toBe("Expecting 'SQE'")
  })
})

describe('DiagramError markup', () => {
  it('shows the title, the trimmed summary and the source', () => {
    const html = renderToStaticMarkup(<DiagramError chart={CHART} error={ERROR} />)

    expect(html).toContain('This diagram didn&#x27;t render')
    expect(html).toContain('Parse error on line 2:')
    expect(html).not.toContain('DIAMOND_START')
    expect(html).toContain('Show source')
  })

  it('has no fix button without onRepair', () => {
    const html = renderToStaticMarkup(<DiagramError chart={CHART} error={ERROR} />)

    expect(html).not.toContain('Fix diagram')
  })

  it('has a fix button with onRepair', () => {
    const html = renderToStaticMarkup(
      <DiagramError chart={CHART} error={ERROR} onRepair={() => Promise.resolve()} />,
    )

    expect(html).toContain('Fix diagram')
  })
})

describe('DiagramError repair', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  const mount = async (element: React.ReactElement) => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(element))
    return {
      container,
      unmount: async () => {
        await act(async () => root.unmount())
        container.remove()
      },
    }
  }

  const fixButton = (container: Element) =>
    [...container.querySelectorAll('button')].find((button) =>
      /Fix|Fixing/.test(button.textContent ?? ''),
    )

  const click = (element: Element | undefined) =>
    act(async () => {
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

  it('calls onRepair with the chart and the full error', async () => {
    const onRepair = mock(() => Promise.resolve())
    const view = await mount(<DiagramError chart={CHART} error={ERROR} onRepair={onRepair} />)

    await click(fixButton(view.container))

    expect(onRepair).toHaveBeenCalledWith({ chart: CHART, error: ERROR })
    await view.unmount()
  })

  it('shows the failure inline and lets the button be clicked again', async () => {
    const onRepair = mock(() => Promise.reject(new Error('model unavailable')))
    const view = await mount(<DiagramError chart={CHART} error={ERROR} onRepair={onRepair} />)

    await click(fixButton(view.container))

    expect(view.container.textContent).toContain('model unavailable')
    expect(fixButton(view.container)?.disabled).toBe(false)
    await view.unmount()
  })

  it('disables the button while the repair is pending', async () => {
    let finish: () => void = () => {}
    const onRepair = mock(() => new Promise<void>((resolve) => (finish = resolve)))
    const view = await mount(<DiagramError chart={CHART} error={ERROR} onRepair={onRepair} />)

    await click(fixButton(view.container))

    expect(fixButton(view.container)?.disabled).toBe(true)
    expect(view.container.textContent).toContain('Fixing…')
    await act(async () => finish())
    await view.unmount()
  })
})
