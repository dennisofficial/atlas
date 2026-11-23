import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { RESUMING_LABEL, RESUME_LABEL } from '@/features/threads/transcript/stopped-line'

import { AgentPanelHeader } from '../session-agent-panel'

const IDENTITY = {
  agentType: 'explore',
  intent: 'find the vault',
  status: 'stopped',
  working: false,
}
const BACK = { text: 'Session', aria: 'Back to session' }

const render = (resume: { pending: boolean; onResume: () => void } | null) =>
  renderToStaticMarkup(
    <AgentPanelHeader
      agentId="agent-7"
      identity={IDENTITY}
      backLabel={BACK}
      resume={resume}
      onClose={() => undefined}
    />,
  )

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name,
  )

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

describe('the sub-agent pane header', () => {
  it('offers Resume for a stopped child', () => {
    const html = render({ pending: false, onResume: () => undefined })

    expect(html).toContain('data-slot="resume-agent"')
    expect(html).toContain(RESUME_LABEL)
  })

  it('shows Resuming… and disables itself while the entry is pending', () => {
    const html = render({ pending: true, onResume: () => undefined })

    expect(html).toContain(RESUMING_LABEL)
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Resuming…<\/button>/)
  })

  it('offers nothing when the child cannot be resumed', () => {
    expect(render(null)).not.toContain('data-slot="resume-agent"')
  })

  it('posts once when the operator presses it', async () => {
    const calls: string[] = []
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () =>
      createRoot(container).render(
        <AgentPanelHeader
          agentId="agent-7"
          identity={IDENTITY}
          backLabel={BACK}
          resume={{ pending: false, onResume: () => calls.push('resume') }}
          onClose={() => undefined}
        />,
      ),
    )

    await act(async () => {
      buttonNamed(RESUME_LABEL)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
    })

    expect(calls).toEqual(['resume'])
  })
})
