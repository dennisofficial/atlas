import { KeyEvent } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { act, type ReactNode } from 'react'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { frameWhen } from '../../ui/__tests__/waiting'
import { useCommandMenu, type CommandMenu } from '../use-command-menu'
import { PRODUCTION_COMMANDS } from './command-catalogue-fixture'
import { fakeSessionClient } from './fake-session-client'

type Rig = {
  menu: () => CommandMenu
  editor: { current: { plainText: string } }
  local: string[]
  setup: Awaited<ReturnType<typeof testRender>>
}

const keyOf = (name: string): KeyEvent =>
  new KeyEvent({
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: '',
    number: false,
    raw: '',
    eventType: 'press',
    source: 'raw',
  })

const mountMenu = async (): Promise<Rig> => {
  const client = fakeSessionClient({ onAuthLost: () => undefined })
  client.setCommands(PRODUCTION_COMMANDS)
  const editor = { current: { plainText: '' } }
  const local: string[] = []
  let captured: CommandMenu | null = null

  function Probe(): ReactNode {
    captured = useCommandMenu({
      api: client.api,
      draft: { editor, setValue: () => undefined, clear: () => undefined },
      onAction: () => undefined,
      onLocal: (name) => local.push(name),
      onRun: () => undefined,
      onProblem: () => undefined,
    })
    return <text>{captured.entries.length > 0 ? 'loaded' : 'loading'}</text>
  }

  const setup = await testRender(<Probe />, { width: 20, height: 2 })
  await frameWhen({ setup, holds: (frame) => frame.includes('loaded') })

  const menu = (): CommandMenu => {
    if (captured === null) throw new Error('the probe never rendered')
    return captured
  }
  return { menu, editor, local, setup }
}

describe('the slash menu hook', () => {
  test('return picks from the text in the editor when the menu has not caught up yet', async () => {
    const rig = await mountMenu()

    try {
      rig.editor.current.plainText = '/'
      act(() => rig.menu().handleText('/'))
      expect(rig.menu().state?.rows[0]?.name).toBe('rewind')

      rig.editor.current.plainText = '/new'
      act(() => {
        rig.menu().handleKey(keyOf('return'))
      })

      expect(rig.local).toEqual(['new'])
    } finally {
      await teardown(rig.setup)
    }
  })

  test('return keeps a menu opened with no slash in the draft', async () => {
    const rig = await mountMenu()

    try {
      act(() => rig.menu().handleOpen())
      act(() => {
        rig.menu().handleKey(keyOf('return'))
      })

      expect(rig.local).toEqual(['rewind'])
    } finally {
      await teardown(rig.setup)
    }
  })
})
