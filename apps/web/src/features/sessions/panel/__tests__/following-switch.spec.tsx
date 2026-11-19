import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { FollowingCommand } from '../details/following'
import { SessionFollowingSwitch } from '../details/following-switch'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, populatedPaneValue } from './fixture'

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await GlobalRegistrator.unregister()
})

const mountSwitch = async (args: {
  value: SessionPaneValue
  run: (sent: { sessionId: string; commands: readonly FollowingCommand[] }) => Promise<void>
}) => {
  await act(async () =>
    root.render(
      <SessionPaneProvider value={args.value}>
        <SessionFollowingSwitch run={args.run} />
      </SessionPaneProvider>,
    ),
  )
  return container.querySelector('[role="switch"]')
}

describe('SessionFollowingSwitch', () => {
  it('subscribes every linked pull request the session does not follow yet', async () => {
    const sent: { sessionId: string; commands: readonly FollowingCommand[] }[] = []
    const value = paneValueFixture({
      view: { ...populatedPaneValue().view, subscriptions: [] },
    })
    const control = await mountSwitch({
      value,
      run: async (sent_) => {
        sent.push(sent_)
      },
    })
    expect(control?.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      ;(control as HTMLElement).click()
    })
    expect(sent).toEqual([
      {
        sessionId: 'ses-1',
        commands: [
          { name: 'subscribe', args: { provider: 'github.pull-request', target: 'owner/atlas#7' } },
        ],
      },
    ])
  })

  it('unsubscribes the session pull requests when turned off', async () => {
    const sent: { sessionId: string; commands: readonly FollowingCommand[] }[] = []
    const control = await mountSwitch({
      value: populatedPaneValue(),
      run: async (sent_) => {
        sent.push(sent_)
      },
    })
    expect(control?.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      ;(control as HTMLElement).click()
    })
    expect(sent).toEqual([
      {
        sessionId: 'ses-1',
        commands: [{ name: 'unsubscribe', args: { subscriptionId: 'sub_7' } }],
      },
    ])
  })

  it('cannot be switched on when the session links no pull requests', async () => {
    const control = await mountSwitch({ value: paneValueFixture(), run: async () => undefined })
    expect(control?.getAttribute('aria-disabled')).toBe('true')
  })
})
