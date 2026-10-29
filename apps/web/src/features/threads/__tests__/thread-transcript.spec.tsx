import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ETranscriptKind, type TranscriptRow } from '../data/transcript-items'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import { ThreadTranscript, type TranscriptRewind } from '../thread-transcript'

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

const mount = async (rewind: TranscriptRewind | null) => {
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
    const picked: { eventId: string; text: string }[] = []
    await mount({ points: new Set(['evt_2']), onRewind: (pick) => picked.push(pick) })

    await act(async () => {
      rewindButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(picked).toEqual([{ eventId: 'evt_2', text: 'try again' }])
  })

  it('renders no rewind action on a user turn that is not a rewind point', async () => {
    await mount({ points: new Set(), onRewind: () => undefined })

    expect(rewindButton()).toBeNull()
  })

  it('renders no rewind action without the rewind prop', async () => {
    await mount(null)

    expect(rewindButton()).toBeNull()
  })
})
