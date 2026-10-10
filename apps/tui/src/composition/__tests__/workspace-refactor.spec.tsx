import { toRunId } from '@dltech/atlas-core'
import { EChannelConnection } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { createBootProgress, EBootStep } from '../boot-progress'
import { BootScreen } from '../boot-screen'
import { ESession } from '../open-session'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { mountInCloud, speaking } from './app-container-cloud-fixture'
import { editorIn, open, until, THINKING, REPLY, THREAD } from './app-fixture'
import { fakeApp, fakeSignedOutCloud, scriptedModelPort } from './fake-app'

await grammarsReady()

const WORKING = 'esc to interrupt'

const STREAMING = 'Atlas derives'

const COMMAND_MENU_ROW = 'replace the history so far'

const INTERRUPTED = 'Interrupted by you'

const WELCOME = 'Describe the work'

const LONG_PASTE = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n')

const PASTED_TOKEN = '[Pasted text'

const script = { thinking: THINKING, reply: REPLY }

describe('keyboard ownership across the extracted workspace', () => {
  it('lets escape close the command menu before it interrupts the running turn', async () => {
    const mounted = await open({
      app: fakeApp({ model: scriptedModelPort({ script, perChunkMs: 500 }) }),
    })

    try {
      await mounted.typeText('go')
      mounted.pressEnter()

      const running = await until({
        holds: async () => (await mounted.frame()).includes(STREAMING),
        within: 30_000,
      })
      expect(running).toBe(true)

      await mounted.typeText('/comp')
      const menuOpen = await until({
        holds: async () => (await mounted.frame()).includes(COMMAND_MENU_ROW),
        within: 20_000,
      })
      expect(menuOpen).toBe(true)

      mounted.pressEscape()
      const menuClosed = await until({
        holds: async () => !(await mounted.frame()).includes(COMMAND_MENU_ROW),
        within: 20_000,
      })
      expect(menuClosed).toBe(true)

      const afterMenu = await mounted.frame()
      expect(afterMenu).toContain(WORKING)
      expect(afterMenu).not.toContain(INTERRUPTED)
      expect(mounted.draftText()).toBe('/comp')

      mounted.pressEscape()
      const interrupted = await until({
        holds: async () => (await mounted.frame()).includes(INTERRUPTED),
        within: 20_000,
      })
      expect(interrupted).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('keeps the draft out of reach of typing and pasting while an overlay covers the composer', async () => {
    const mounted = await open({
      app: fakeApp({ model: scriptedModelPort({ script }), cloud: fakeSignedOutCloud() }),
    })

    try {
      await mounted.typeText('keep me')
      expect(mounted.draftText()).toBe('keep me')

      mounted.pressCtrl('t')
      await mounted.frame()

      await mounted.typeText('stray')
      await mounted.paste(LONG_PASTE)
      const covered = await mounted.frame()
      expect(covered).not.toContain(PASTED_TOKEN)
      expect(mounted.draftText()).toBe('keep me')

      mounted.pressEscape()
      await mounted.frame()
      expect(mounted.draftText()).toBe('keep me')

      await mounted.typeText('!')
      expect(mounted.draftText()).toBe('keep me!')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('the startup curtain over the extracted workspace', () => {
  it('drops a pasted block instead of folding it into the draft behind the curtain', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script }), cloud: fakeSignedOutCloud() })
    const progress = createBootProgress()
    progress.report(EBootStep.Opening)

    const setup = await testRender(
      <BootScreen
        session={Promise.resolve({
          type: ESession.Ready,
          app,
          opened: { threadId: THREAD, events: [], turns: [], name: null, started: true },
          credentialNotice: null,
        })}
        progress={progress}
        cwd="/Users/dennis/Developer/atlas"
        onAbandon={() => undefined}
      />,
      { width: 120, height: 32 },
    )

    try {
      await setup.flush()
      await setup.mockInput.pasteBracketedText(LONG_PASTE)

      const lifted = await until({
        holds: async () => {
          await setup.flush()
          await settle(60)
          return setup.captureCharFrame().includes(WELCOME)
        },
        within: 20_000,
      })
      expect(lifted).toBe(true)

      await settle(250)
      await setup.flush()

      expect(setup.captureCharFrame()).not.toContain(PASTED_TOKEN)
      expect(editorIn(setup.renderer.root)?.plainText ?? '').toBe('')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe('a cloud reload remounting the workspace', () => {
  it('carries the unsent draft over without sending it', async () => {
    const bridge = fakeBridge()
    const mounted = await mountInCloud({ app: speaking(), bridge })
    const said = 'landed while the stream gapped'
    const draft = 'half a thought about the auth seam'

    try {
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      await mounted.frame()

      await mounted.typeText(draft)
      await bridge.log.append({
        threadId: THREAD,
        runId: toRunId('run-in-the-sandbox'),
        drafts: [{ type: 'user-said', text: said }],
      })
      bridge.channel.reload({ sinceEventSeq: 0 })

      const remounted = await until({
        holds: async () => (await mounted.frame()).includes(said),
        within: 20_000,
      })
      expect(remounted).toBe(true)
      expect(mounted.draftText()).toBe(draft)
      expect(await mounted.frame()).toContain(draft)

      const events = await bridge.log.read({ threadId: THREAD })
      expect(events.some((event) => event.type === 'user-said' && event.text === draft)).toBe(false)
      expect(bridge.channel.sent).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
