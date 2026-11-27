import { mock } from 'bun:test'

import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

const wakes: string[] = []

const realApiClient = { ...(await import('@/lib/api-client')) }

mock.module('@/lib/api-client', () => ({
  cloudCall: <T>(promise: Promise<T>): Promise<T> => promise,
  api: {
    sessions: {
      wakePod: {
        mutate: (input: { sessionId: string }) => {
          wakes.push(input.sessionId)
          return Promise.resolve({ state: 'waking' })
        },
      },
    },
  },
}))

const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } = await import(
  'bun:test'
)
const { act, createElement } = await import('react')
const { registerDom, unregisterDom } = await import('@/lib/__tests__/happy-dom-globals')
const { EPodPowerPhase } = await import('@dltech/atlas-core')
const { EPreviewStatus } = await import('@dltech/atlas-ui/ai/preview-browser')
const { openTab } = await import('@/features/threads/data/preview-browser/browser-model')
const { resetPreviewBrowsers, updatePreviewBrowser, usePreviewBrowser } = await import(
  '@/features/threads/data/preview-browser/use-preview-browser'
)
const { usePreviewWake } = await import('../use-preview-wake')

const SESSION = 'ses_1'
const PREVIEW = 'https://4321-abc.byatlas.dev/'
const PORTS: PreviewPort[] = [
  {
    id: 'service:svc1',
    port: 4321,
    label: 'web',
    url: PREVIEW,
    status: EPreviewStatus.Live,
  },
]

const opened: string[] = []

function Probe(props: { power: EPodPowerPhase | undefined }) {
  const open = usePreviewWake({
    sessionId: SESSION,
    power: props.power,
    ports: PORTS,
    open: (url) => opened.push(url),
  })
  const { state } = usePreviewBrowser(SESSION)
  return createElement('button', {
    type: 'button',
    'data-open': '',
    'data-seqs': state.tabs.map((tab) => tab.load.seq).join(','),
    onClick: () => open(PREVIEW),
  })
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('@/lib/api-client', () => realApiClient)
  await unregisterDom()
})

beforeEach(() => {
  resetPreviewBrowsers()
  try {
    window.localStorage.clear()
  } catch {}
  resetPreviewBrowsers()
  opened.length = 0
  wakes.length = 0
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(): Promise<{
  container: HTMLDivElement
  renderWith: (node: unknown) => Promise<void>
}> {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  return {
    container,
    renderWith: async (node) => {
      await act(async () => root.render(node))
    },
  }
}

describe('usePreviewWake', () => {
  it('opens at once on an awake pod without asking for a wake', async () => {
    const { container, renderWith } = await mount()
    await renderWith(createElement(Probe, { power: EPodPowerPhase.Steady }))
    await act(async () => {
      container
        .querySelector('[data-open]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(opened).toEqual([PREVIEW])
    expect(wakes).toEqual([])
  })

  it('wakes a sleeping pod and opens only once it is awake', async () => {
    const { container, renderWith } = await mount()
    await renderWith(createElement(Probe, { power: EPodPowerPhase.Asleep }))
    await act(async () => {
      container
        .querySelector('[data-open]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(wakes).toEqual([SESSION])
    expect(opened).toEqual([])
    await renderWith(createElement(Probe, { power: EPodPowerPhase.Starting }))
    expect(opened).toEqual([])
    await renderWith(createElement(Probe, { power: EPodPowerPhase.Steady }))
    expect(opened).toEqual([PREVIEW])
  })

  it('reloads a preview already on screen when the pod comes back', async () => {
    updatePreviewBrowser({
      threadId: SESSION,
      change: ({ state }) => openTab({ state, url: PREVIEW }),
    })
    const { container, renderWith } = await mount()
    await renderWith(createElement(Probe, { power: EPodPowerPhase.Asleep }))
    expect(container.querySelector('[data-seqs]')?.getAttribute('data-seqs')).toBe('0,0')
    await renderWith(createElement(Probe, { power: EPodPowerPhase.Steady }))
    expect(container.querySelector('[data-seqs]')?.getAttribute('data-seqs')).toBe('0,1')
  })
})
