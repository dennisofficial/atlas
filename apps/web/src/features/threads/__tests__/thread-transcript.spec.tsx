import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ETranscriptKind, type TranscriptRow } from '../data/transcript-items'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import { ThreadTranscript } from '../thread-transcript'

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

const panel: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  clearAgent: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

const items: TranscriptRow[] = [
  {
    kind: ETranscriptKind.User,
    id: 'evt_2',
    text: 'try again',
    at: '2026-10-28T10:00:00.000Z',
  },
]

const mount = async (rewind: { onRewind: (eventId: string) => void } | null) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <ThreadPanelProvider value={panel}>
        <ThreadTranscript
          items={items}
          failure={null}
          pod={null}
          bootNow={0}
          working={false}
          onRetryBoot={() => undefined}
          rewind={rewind}
        />
      </ThreadPanelProvider>,
    ),
  )
}

const rewindButton = () => document.body.querySelector('button[aria-label="Rewind to here"]')

describe('ThreadTranscript rewind', () => {
  it('renders the rewind action on a user turn and reports the event id', async () => {
    const picked: string[] = []
    await mount({ onRewind: (eventId) => picked.push(eventId) })

    await act(async () => {
      rewindButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(picked).toEqual(['evt_2'])
  })

  it('renders no rewind action without the rewind prop', async () => {
    await mount(null)

    expect(rewindButton()).toBeNull()
  })
})
