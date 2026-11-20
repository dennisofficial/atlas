import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { PaneCommand } from '../pane-command'
import { notePaneLocation } from '../pane-locations'
import { createPaneSync, type PaneSender } from '../pane-sync'
import { fakeEnvironment, RECT, recorder, settle, slotAt, URL_A } from './pane-sync-harness'

describe('createPaneSync', () => {
  beforeAll(() => {
    registerDom()
  })

  afterAll(async () => {
    await unregisterDom()
  })

  it('navigates the shown pane when the tab url changes', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    const sync = createPaneSync({ element, url: URL_A, send, environment })
    sync.apply('https://example.com/b')
    sync.apply('https://example.com/b')
    await settle()
    expect(sent.slice(1)).toEqual([{ kind: 'navigate', url: 'https://example.com/b' }])
  })

  it('leaves the pane alone when the tab follows the address the pane reported', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    const id = 'pane:reported:tab-1'
    const reported = 'https://example.com/reported'
    notePaneLocation({ id, url: reported })
    const sync = createPaneSync({ element, url: URL_A, send, environment, id })
    sync.apply(reported)
    await settle()
    expect(sent.slice(1)).toEqual([])
  })

  it('navigates back to an address the pane reported before, once it has moved on', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    const id = 'pane:reported-then-elsewhere:tab-1'
    notePaneLocation({ id, url: URL_A })
    const sync = createPaneSync({ element, url: URL_A, send, environment, id })
    sync.apply('https://example.com/b')
    await settle()
    sync.apply(URL_A)
    await settle()
    expect(sent.slice(1)).toEqual([
      { kind: 'navigate', url: 'https://example.com/b' },
      { kind: 'navigate', url: URL_A },
    ])
  })

  it('shows a remounted target without navigating when its url is unchanged', async () => {
    const first = slotAt(RECT)
    const firstRun = recorder()
    const firstSync = createPaneSync({
      element: first.element,
      id: 'pane:remount:unchanged',
      url: URL_A,
      send: firstRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    firstSync.stop()
    const second = slotAt(RECT)
    const secondRun = recorder()
    createPaneSync({
      element: second.element,
      id: 'pane:remount:unchanged',
      url: URL_A,
      send: secondRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    expect(secondRun.sent.filter((command) => command.kind === 'navigate')).toEqual([])
    expect(secondRun.sent[0]).toMatchObject({ kind: 'show', url: URL_A })
  })

  it('navigates again to an address the shell refused to take', async () => {
    const { element } = slotAt(RECT)
    const sent: PaneCommand[] = []
    let refuse = true
    const send: PaneSender = async (command) => {
      sent.push(command)
      return !refuse
    }
    const sync = createPaneSync({
      element,
      id: 'pane:refused:tab-1',
      url: URL_A,
      send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    sync.apply('https://example.com/b')
    await settle()
    refuse = false
    sync.apply(URL_A)
    await settle()
    sync.apply('https://example.com/b')
    await settle()
    expect(sent.filter((command) => command.kind === 'navigate')).toEqual([
      { kind: 'navigate', url: 'https://example.com/b' },
      { kind: 'navigate', url: URL_A },
      { kind: 'navigate', url: 'https://example.com/b' },
    ])
  })

  it('navigates a remounted target whose url changed while it was away', async () => {
    const first = slotAt(RECT)
    const firstRun = recorder()
    const firstSync = createPaneSync({
      element: first.element,
      id: 'pane:remount:changed',
      url: URL_A,
      send: firstRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    firstSync.stop()
    const second = slotAt(RECT)
    const secondRun = recorder()
    createPaneSync({
      element: second.element,
      id: 'pane:remount:changed',
      url: 'https://example.com/moved',
      send: secondRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    expect(secondRun.sent.filter((command) => command.kind === 'navigate')).toEqual([
      { kind: 'navigate', url: 'https://example.com/moved' },
    ])
  })
})
