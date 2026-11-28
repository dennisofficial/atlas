import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { subscribePreviewDocuments, type PreviewDocumentReport } from '../preview-document-reports'
import { useFrameReports } from '../use-frame-reports'

const ORIGIN = 'https://3000-abcdefghij.byatlas.dev'
const reports: PreviewDocumentReport[] = []
let root: Root
let host: HTMLDivElement
let unsubscribe: () => void

function Probe() {
  const reportsFrom = useFrameReports()
  return createElement('iframe', {
    srcDoc: '<html><head></head><body></body></html>',
    ref: reportsFrom({
      key: 'session:tab-1',
      threadId: 'session',
      tabId: 'tab-1',
      url: `${ORIGIN}/`,
      load: { url: `${ORIGIN}/`, seq: 0 },
    }),
  })
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await unregisterDom()
})
afterEach(async () => {
  unsubscribe()
  await act(async () => root.unmount())
  host.remove()
})

async function mount() {
  reports.length = 0
  unsubscribe = subscribePreviewDocuments((report) => reports.push(report))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(Probe)))
  const iframe = host.querySelector('iframe')
  if (iframe === null) throw new Error('Missing iframe')
  return iframe
}

describe('frame document reports', () => {
  it('forwards validated starting-page and loaded signals from the held frame', async () => {
    const iframe = await mount()
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: iframe.contentWindow,
          origin: ORIGIN,
          data: {
            kind: 'atlas-preview:location',
            url: `${ORIGIN}/`,
            title: '',
            startingPage: true,
            loaded: true,
          },
        }),
      ),
    )
    expect(reports).toEqual([
      {
        sessionId: 'session',
        tabId: 'tab-1',
        url: `${ORIGIN}/`,
        startingPage: true,
        loaded: true,
      },
    ])
  })

  it('does not forward unvalidated or foreign-window document signals', async () => {
    const iframe = await mount()
    await act(async () => {
      for (const entry of [
        { source: iframe.contentWindow, origin: ORIGIN, startingPage: 'false' },
        { source: window, origin: ORIGIN, startingPage: false },
        { source: iframe.contentWindow, origin: 'https://example.com', startingPage: false },
      ]) {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: entry.source,
            origin: entry.origin,
            data: {
              kind: 'atlas-preview:location',
              url: `${ORIGIN}/`,
              title: '',
              startingPage: entry.startingPage,
              loaded: true,
            },
          }),
        )
      }
    })
    expect(reports).toEqual([])
  })
})
