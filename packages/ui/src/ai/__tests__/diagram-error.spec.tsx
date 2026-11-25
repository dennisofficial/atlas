import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DiagramError, type DiagramRepairArgs } from '../diagram-error'
import { summarizeDiagramError } from '../internal/diagram-error-summary'
import { isStaleBundleError } from '../internal/stale-bundle'

const CHUNK_ERROR = 'Failed to load chunk /_next/static/chunks/44e481n96lq2a.js from module 991481'

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

describe('isStaleBundleError', () => {
  it.each([
    CHUNK_ERROR,
    'ChunkLoadError: Loading chunk 123 failed.',
    'Failed to fetch dynamically imported module: http://127.0.0.1/_next/static/chunks/a.js',
    'Importing a module script failed.',
  ])('recognises %s', (error) => {
    expect(isStaleBundleError(error)).toBe(true)
  })

  it('leaves a parse error alone', () => {
    expect(isStaleBundleError(ERROR)).toBe(false)
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

  it('offers no manual repair button', () => {
    const plain = renderToStaticMarkup(<DiagramError chart={CHART} error={ERROR} />)
    const repairing = renderToStaticMarkup(
      <DiagramError chart={CHART} error={ERROR} onRepair={() => Promise.resolve()} />,
    )

    expect(plain).not.toContain('Fix diagram')
    expect(repairing).not.toContain('Fix diagram')
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

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  const mount = async (element: React.ReactElement) => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(element))
    return {
      container,
      render: async (next: React.ReactElement) => {
        await act(async () => root.render(next))
      },
      unmount: async () => {
        await act(async () => root.unmount())
        container.remove()
      },
    }
  }

  it('asks for the repair on its own, with the chart and the full error', async () => {
    const onRepair = mock(async (_args: DiagramRepairArgs) => {})
    const view = await mount(<DiagramError chart={CHART} error={ERROR} onRepair={onRepair} />)

    expect(onRepair).toHaveBeenCalledTimes(1)
    expect(onRepair.mock.calls[0]?.[0]).toEqual({ chart: CHART, error: ERROR })
    await view.unmount()
  })

  it('asks once per chart, even when the handler changes identity', async () => {
    const first = mock(() => Promise.resolve())
    const second = mock(() => Promise.resolve())
    const view = await mount(<DiagramError chart={CHART} error={ERROR} onRepair={first} />)

    await view.render(<DiagramError chart={CHART} error={ERROR} onRepair={second} />)
    await settle()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('needs no repair call without a handler', async () => {
    const view = await mount(<DiagramError chart={CHART} error={ERROR} />)

    expect(view.container.textContent).toContain('Parse error on line 2:')
    await view.unmount()
  })

  it('shows the pending state instead of the error body while the repair runs', async () => {
    let finish: () => void = () => {}
    const onRepair = mock(() => new Promise<void>((resolve) => (finish = resolve)))
    const view = await mount(<DiagramError chart={CHART} error={ERROR} onRepair={onRepair} />)

    expect(view.container.textContent).toContain('Fixing diagram…')
    expect(view.container.textContent).not.toContain('Parse error on line 2:')

    await act(async () => finish())
    await settle()

    expect(view.container.textContent).not.toContain('Fixing diagram…')
    await view.unmount()
  })

  it('asks for a reload instead of a repair when the renderer did not load', async () => {
    const onRepair = mock(() => Promise.resolve())
    const view = await mount(<DiagramError chart={CHART} error={CHUNK_ERROR} onRepair={onRepair} />)

    await settle()

    expect(onRepair).not.toHaveBeenCalled()
    expect(view.container.textContent).toContain('Reload')
    expect(view.container.textContent).not.toContain('Fixing diagram…')
    await view.unmount()
  })

  it('shows the reason under the original error when the repair fails', async () => {
    const onRepair = mock(() => Promise.reject(new Error('model unavailable')))
    const view = await mount(<DiagramError chart={CHART} error={ERROR} onRepair={onRepair} />)

    await settle()

    expect(view.container.textContent).toContain('Parse error on line 2:')
    expect(view.container.textContent).toContain('model unavailable')
    expect(view.container.textContent).not.toContain('Fixing diagram…')
    await view.unmount()
  })
})
