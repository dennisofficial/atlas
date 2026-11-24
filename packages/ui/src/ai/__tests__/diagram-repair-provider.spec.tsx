import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactElement } from 'react'

import {
  DiagramMessageScope,
  DiagramRepairProvider,
  MermaidErrorView,
  type DiagramRepairRequest,
} from '../diagram-repair'

const CHART = 'flowchart LR\n  A[Start --> B{Check'
const ERROR =
  "Parse error on line 2:\n...A[Start --> B{Check\n---^\nExpecting 'SQE', 'PE', got 'DIAMOND_START'"
const REPORT = `# Report\n\nThe chart is broken.\n\n\`\`\`mermaid\n${CHART}\n\`\`\`\n\nThat is all.`

describe('diagram repair provider', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  const mount = async (element: ReactElement) => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(element))
    await settle()
    return {
      container,
      unmount: async () => {
        await act(async () => root.unmount())
        container.remove()
      },
    }
  }

  it('asks for the repair with the message the chart sits in', async () => {
    const repair = mock(async (_request: DiagramRepairRequest) => {})
    const view = await mount(
      <DiagramRepairProvider repair={repair}>
        <DiagramMessageScope message={{ text: REPORT, messageId: 'evt-7' }}>
          <MermaidErrorView chart={CHART} error={ERROR} />
        </DiagramMessageScope>
      </DiagramRepairProvider>,
    )

    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair.mock.calls[0]?.[0]).toEqual({
      chart: CHART,
      error: ERROR,
      messageText: REPORT,
      messageId: 'evt-7',
    })
    await view.unmount()
  })

  it('does not repair when no provider is above the chart', async () => {
    const view = await mount(
      <DiagramMessageScope message={{ text: REPORT }}>
        <MermaidErrorView chart={CHART} error={ERROR} />
      </DiagramMessageScope>,
    )

    expect(view.container.textContent).toContain('Parse error on line 2:')
    expect(view.container.textContent).not.toContain('Fixing diagram')
    await view.unmount()
  })

  it('does not repair when the message has no text to give as context', async () => {
    const repair = mock(async (_request: DiagramRepairRequest) => {})
    const view = await mount(
      <DiagramRepairProvider repair={repair}>
        <MermaidErrorView chart={CHART} error={ERROR} />
      </DiagramRepairProvider>,
    )

    expect(repair).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('shows the pending state while the repair runs', async () => {
    const repair = mock(() => new Promise<void>(() => {}))
    const view = await mount(
      <DiagramRepairProvider repair={repair}>
        <DiagramMessageScope message={{ text: REPORT }}>
          <MermaidErrorView chart={CHART} error={ERROR} />
        </DiagramMessageScope>
      </DiagramRepairProvider>,
    )

    expect(view.container.textContent).toContain('Fixing diagram…')
    await view.unmount()
  })
})
