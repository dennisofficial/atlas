import { beforeEach, describe, expect, it } from 'bun:test'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import {
  activeTabOf,
  type BrowserState,
  currentUrlOf,
} from '@/features/threads/data/preview-browser/browser-model'
import {
  resetPreviewBrowsers,
  updatePreviewBrowser,
} from '@/features/threads/data/preview-browser/use-preview-browser'

import { openBrowserUrl } from '../open-browser'

const SESSION = 'ses_1'
const PREVIEW = 'https://4321-abc.byatlas.dev/'
const ELSEWHERE = 'https://example.com/'
const PORTS: PreviewPort[] = [
  { id: 'service:svc1', port: 4321, label: 'web', url: PREVIEW, status: EPreviewStatus.Live },
]

const stateOf = (): BrowserState => {
  let held: BrowserState | undefined
  updatePreviewBrowser({
    threadId: SESSION,
    change: ({ state }) => {
      held = state
      return state
    },
  })
  if (held === undefined) throw new Error('the browser store handed back no state')
  return held
}

describe('openBrowserUrl', () => {
  beforeEach(() => {
    resetPreviewBrowsers()
  })

  it('opens the preview in a tab of its own the first time', () => {
    openBrowserUrl({ sessionId: SESSION, url: PREVIEW, ports: PORTS })
    const state = stateOf()
    expect(state.tabs).toHaveLength(1)
    expect(currentUrlOf(activeTabOf(state)!)).toBe(PREVIEW)
  })

  it('reuses the tab that already shows the preview, and reloads it', () => {
    openBrowserUrl({ sessionId: SESSION, url: PREVIEW, ports: PORTS })
    openBrowserUrl({ sessionId: SESSION, url: ELSEWHERE, ports: PORTS })
    openBrowserUrl({ sessionId: SESSION, url: PREVIEW, ports: PORTS })
    const state = stateOf()
    expect(state.tabs).toHaveLength(2)
    expect(state.activeId).toBe('tab-1')
    expect(state.tabs[0]?.load.seq).toBe(2)
  })
})
