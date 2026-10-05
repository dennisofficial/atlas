import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EImageDelivery } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import type { ClipboardImage, ClipboardImageReader } from '../../ui/clipboard-image'
import { liveTokens } from '../../ui/composer-tokens'
import { open, until, THREAD, REPLY, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()

const WIDTH = 560

const HEIGHT = 280

/** Signature plus IHDR is all `pngSize` reads, and all this fixture has to be. */
const tinyPng = (): Buffer => {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(WIDTH, 16)
  header.writeUInt32BE(HEIGHT, 20)
  return header
}

const onTheClipboard = (over: Partial<ClipboardImage> = {}): ClipboardImageReader => {
  const bytes = tinyPng()
  const path = join(mkdtempSync(join(tmpdir(), 'atlas-paste-')), 'shot.png')
  writeFileSync(path, bytes)

  return async () => ({
    path,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: WIDTH,
    height: HEIGHT,
    delivery: EImageDelivery.Inline,
    tokens: 200,
    ...over,
  })
}

const nothingOnTheClipboard: ClipboardImageReader = async () => null

const slowly = () =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY }, perChunkMs: 50 }),
  })

describe('a restored draft with a picture', () => {
  it('returns a queued message that is only a picture as one live token, never two labels', async () => {
    const mounted = await open({ app: slowly(), clipboard: onTheClipboard() })

    try {
      await mounted.typeText('start')
      mounted.pressEnter()

      const running = await until({
        holds: async () => (await mounted.frame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(running).toBe(true)

      mounted.pressCtrl('v')
      await mounted.frame()
      mounted.pressEnter()

      const queued = await until({
        holds: async () => (await mounted.frame()).includes('↑ to edit'),
        within: 20_000,
      })
      expect(queued).toBe(true)

      mounted.pressUp()

      const returned = await until({
        holds: async () => {
          await mounted.frame()
          const draft = mounted.draftText()
          return draft !== null && draft.includes('[Image #1]') && !draft.includes('↑')
        },
        within: 20_000,
      })
      expect(returned).toBe(true)

      const draft = mounted.draftText() ?? ''
      expect(draft).toBe('[Image #1]')
      expect(draft.split('[Image #1]').length - 1).toBe(1)

      const editor = mounted.editor()
      expect(editor).not.toBeNull()
      const tokens = editor === null ? [] : liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({
        start: 0,
        end: '[Image #1]'.length,
        ordinal: 1,
        slot: { kind: 'image', settled: true },
      })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('returns a queued mid-text picture to its own span on ↑, not the end of the draft', async () => {
    const mounted = await open({ app: slowly(), clipboard: onTheClipboard() })

    try {
      await mounted.typeText('start')
      mounted.pressEnter()

      const running = await until({
        holds: async () => (await mounted.frame()).includes('esc to interrupt'),
        within: 20_000,
      })
      expect(running).toBe(true)

      await mounted.typeText('look at ')
      mounted.pressCtrl('v')
      await mounted.frame()
      await mounted.typeText('closely')
      mounted.pressEnter()

      const queued = await until({
        holds: async () => (await mounted.frame()).includes('↑ to edit'),
        within: 20_000,
      })
      expect(queued).toBe(true)

      mounted.pressUp()

      const returned = await until({
        holds: async () => {
          await mounted.frame()
          const draft = mounted.draftText()
          return draft !== null && draft.includes('[Image #1]') && !draft.includes('↑')
        },
        within: 20_000,
      })
      expect(returned).toBe(true)

      const draft = mounted.draftText() ?? ''
      expect(draft).toBe('look at [Image #1] closely')

      const editor = mounted.editor()
      expect(editor).not.toBeNull()
      const tokens = editor === null ? [] : liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({
        start: 'look at '.length,
        end: 'look at [Image #1]'.length,
        ordinal: 1,
        slot: { kind: 'image', settled: true },
      })
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('returns an undone mid-text picture to its own span on esc, not the end of the draft', async () => {
    const mounted = await open({
      app: fakeApp({
        model: scriptedModelPort({
          script: { thinking: THINKING, reply: REPLY },
          perChunkMs: 200,
        }),
      }),
      clipboard: onTheClipboard(),
    })

    try {
      await mounted.typeText('look at ')
      mounted.pressCtrl('v')
      await mounted.frame()
      await mounted.typeText('closely')
      mounted.pressEnter()

      const thinking = await until({
        holds: async () => (await mounted.frame()).includes('Thinking'),
        within: 20_000,
      })
      expect(thinking).toBe(true)

      mounted.pressEscape()

      const emptied = await until({
        holds: async () => {
          await mounted.frame()
          return (await mounted.app.log.read({ threadId: THREAD })).length === 0
        },
        within: 20_000,
      })
      expect(emptied).toBe(true)

      const draft = mounted.draftText() ?? ''
      expect(draft).toBe('look at [Image #1] closely')

      const editor = mounted.editor()
      expect(editor).not.toBeNull()
      const tokens = editor === null ? [] : liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({
        start: 'look at '.length,
        end: 'look at [Image #1]'.length,
        ordinal: 1,
        slot: { kind: 'image', settled: true },
      })
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('a restored draft with a pasted block', () => {
  it('keeps the full pasted content on resend after the message is refused', async () => {
    const mounted = await open({ app: slowly(), clipboard: nothingOnTheClipboard })

    try {
      await mounted.typeText('/agents ')
      await mounted.paste('one\ntwo\nthree\nfour\nfive\nsix')

      expect(await mounted.frame()).toContain('[Pasted text #1')

      mounted.pressEnter()

      const returned = await until({
        holds: async () => {
          await mounted.frame()
          const draft = mounted.draftText()
          return draft !== null && draft.includes('[Pasted text #1 +6 lines]')
        },
        within: 20_000,
      })
      expect(returned).toBe(true)

      const editor = mounted.editor()
      expect(editor).not.toBeNull()
      const tokens = editor === null ? [] : liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]?.slot).toEqual({
        kind: 'pasted',
        label: '[Pasted text #1 +6 lines]',
        content: 'one\ntwo\nthree\nfour\nfive\nsix',
      })

      if (editor === null) throw new Error('the composer never mounted')
      editor.setSelection(0, '/agents '.length)
      editor.deleteSelection()

      expect(mounted.draftText()).toBe('[Pasted text #1 +6 lines] ')

      mounted.pressEnter()

      const sent = await until({
        holds: async () => {
          await mounted.frame()
          const events = await mounted.app.log.read({ threadId: THREAD })
          return events.some(
            (event) => event.type === 'user-said' && event.text.includes('four'),
          )
        },
        within: 20_000,
      })
      expect(sent).toBe(true)

      const events = await mounted.app.log.read({ threadId: THREAD })
      const said = events.find((event) => event.type === 'user-said')
      expect(said?.type === 'user-said' ? said.text : '').toBe('one\ntwo\nthree\nfour\nfive\nsix')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
