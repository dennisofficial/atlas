import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { PullRequestBell } from '../details/pull-request-bell'
import type { BellCommand } from '../details/pull-request-bell-model'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, populatedPaneValue, pullRequestFixture } from './fixture'

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await unregisterDom()
})

type Sent = { sessionId: string; command: BellCommand }

const clickBell = async (value: SessionPaneValue): Promise<Sent[]> => {
  const sent: Sent[] = []
  await act(async () =>
    root.render(
      <SessionPaneProvider value={value}>
        <PullRequestBell
          entry={pullRequestFixture}
          run={async (args) => {
            sent.push(args)
          }}
        />
      </SessionPaneProvider>,
    ),
  )
  await act(async () => {
    ;(container.querySelector('button') as HTMLElement).click()
  })
  return sent
}

describe('PullRequestBell', () => {
  it('subscribes the pull request when the session does not follow it', async () => {
    const sent = await clickBell(
      paneValueFixture({ view: { ...populatedPaneValue().view, subscriptionRows: [] } }),
    )
    expect(sent).toEqual([
      {
        sessionId: 'ses-1',
        command: {
          name: 'subscribe',
          provider: 'github.pull-request',
          target: 'owner/atlas#7',
        },
      },
    ])
  })

  it('unsubscribes the pull request when the session follows it', async () => {
    const sent = await clickBell(populatedPaneValue())
    expect(sent).toEqual([
      { sessionId: 'ses-1', command: { name: 'unsubscribe', subscriptionId: 'sub_7' } },
    ])
  })
})
