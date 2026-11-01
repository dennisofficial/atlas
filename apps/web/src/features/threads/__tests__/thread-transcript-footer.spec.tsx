import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { createTestQueryClient } from '@/lib/__tests__/query-test-provider'
import { ETranscriptKind, type TranscriptRow } from '../data/transcript-items'
import { mount, mountWith } from './transcript-mount'
import { installVirtuaViewport } from './virtua-viewport'

let restoreViewport = () => {}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoreViewport = installVirtuaViewport()
})

afterAll(async () => {
  restoreViewport()
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const TIME = /^\d{1,2}:\d{2} (AM|PM)$/

const signedInClient = (): QueryClient => {
  const client = createTestQueryClient()
  client.setQueryData(['session-user'], {
    value: { name: 'Dennis', email: 'd@example.com', image: null },
  })
  return client
}

const footerLabels = (): string[] =>
  [...document.body.querySelectorAll('[data-slot="message-footer"]')].map((footer) =>
    [...footer.querySelectorAll('button, span')]
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '')
      .map((label) => (TIME.test(label) ? 'time' : label))
      .join('|'),
  )

describe('ThreadTranscript message footers', () => {
  it('orders the user footer time, copy, rewind and copies the raw text', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    })
    const raw = '**bold** `code`'
    await mountWith({
      client: signedInClient(),
      rewind: { points: new Set(['u1']), onRewind: () => undefined },
      rows: [
        {
          kind: ETranscriptKind.User,
          id: 'u1',
          text: raw,
          at: '2026-10-28T10:00:00.000Z',
        },
      ],
    })

    expect(footerLabels()).toEqual(['time|Copy|Rewind to here'])
    await act(async () => {
      document.body
        .querySelector('button[aria-label="Copy"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(written).toEqual([raw])
  })

  it('names the speaker only for screen readers', async () => {
    await mountWith({ client: signedInClient(), rewind: null })

    expect(document.body.querySelector('[data-slot="message-header"]')).toBeNull()
    const name = [...document.body.querySelectorAll('span')].find(
      (el) => el.textContent === 'Dennis',
    )
    expect(name?.className).toContain('sr-only')
  })

  it('offers no copy on an image-only user message', async () => {
    await mountWith({
      rewind: { points: new Set(['u1']), onRewind: () => undefined },
      rows: [
        {
          kind: ETranscriptKind.User,
          id: 'u1',
          text: '  ',
          at: '2026-10-28T10:00:00.000Z',
          images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGk=' }],
        },
      ],
    })

    expect(footerLabels()).toEqual(['time|Rewind to here'])
  })

  it('puts the assistant timestamp after the actions, and keeps only it while streaming', async () => {
    const agent = (streaming: boolean): TranscriptRow => ({
      kind: ETranscriptKind.Agent,
      id: 'a1',
      text: 'Answer',
      streaming,
      at: '2026-10-28T10:00:01.000Z',
    })
    await mount(null, [agent(false)])
    expect(footerLabels()).toEqual(['Copy|time'])

    document.body.innerHTML = ''
    await mount(null, [agent(true)])
    expect(footerLabels()).toEqual(['time'])
    expect(document.body.querySelector('button[aria-label="Copy"]')).toBeNull()
  })
})
