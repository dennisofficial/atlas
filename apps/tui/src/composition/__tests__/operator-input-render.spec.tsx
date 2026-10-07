import { describe, expect, it, mock } from 'bun:test'
import { RGBA } from '@opentui/core'
import { act } from 'react'

import { OPERATOR_INPUT_HEADING } from '../../ui/components/operator-input'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { theme } from '../../ui/theme'
import { open, THREAD } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'
import { INPUT_REQUEST, MULTILINE, SHIFT_ENTER_SEQUENCE, mountInput } from './operator-input-fixture'

await grammarsReady()

describe('operator input overlay in the real workspace', () => {
  it('edits with Shift+Enter and submits with Enter without leaking into the conversation composer', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }) })
    const answer = mock(async (_args: { requestId: string; value: string }) => ({ ok: true, bytes: 0 } as const))
    app.operatorInput.answer = answer
    const mounted = await open({ app })
    const capture = async () => {
      let frame = ''
      await act(async () => { frame = await mounted.frame() })
      return frame
    }
    try {
      await act(async () => { await mounted.typeText('/comp') })
      await capture()
      act(() => app.channel.publisherFor({ threadId: THREAD }).operatorInput({ open: INPUT_REQUEST }))
      expect(await capture()).toContain(OPERATOR_INPUT_HEADING)
      await act(async () => { await mounted.paste(MULTILINE) })
      await act(async () => { await mounted.typeText(SHIFT_ENTER_SEQUENCE) })
      const frame = await capture()
      expect(frame).not.toContain('[Pasted text')
      expect(answer).not.toHaveBeenCalled()
      expect(mounted.draftText()).toBe('/comp')
      act(() => mounted.pressEnter())
      await capture()
      expect(answer).toHaveBeenCalledTimes(1)
      expect(answer).toHaveBeenCalledWith({ requestId: INPUT_REQUEST.requestId, value: MULTILINE + '\n' })
      expect(answer.mock.calls[0]?.[0].value).not.toBe(MULTILINE + '\n\n')
      expect(mounted.draftText()).toBe('/comp')
      expect(app.turnsDriven).toBe(0)
      act(() => app.channel.publisherFor({ threadId: THREAD }).operatorInput({ open: null }))
      expect(await capture()).not.toContain(OPERATOR_INPUT_HEADING)
      expect(mounted.draftText()).toBe('/comp')
    } finally {
      await act(async () => { await mounted.done() })
    }
  })
})

describe('native operator input history', () => {
  it('preserves original newline bytes across undo and redo', async () => {
    const mounted = await mountInput()
    const value = 'first\r\nsecond\rthird\n'
    const answer = mock(async (_args: { requestId: string; value: string }) => ({ ok: true, bytes: 0 } as const))
    mounted.app.operatorInput.answer = answer
    try {
      mounted.announce()
      await mounted.flush()
      await mounted.input.pasteBracketedText(value)
      await mounted.flush()
      act(() => { mounted.control().editor.current?.undo() })
      await mounted.flush()
      expect(mounted.control().editor.current?.plainText).toBe('')
      act(() => { mounted.control().editor.current?.redo() })
      await mounted.flush()
      mounted.input.pressEnter()
      await mounted.flush()
      expect(answer).toHaveBeenCalledWith({ requestId: INPUT_REQUEST.requestId, value })
    } finally {
      await mounted.done()
    }
  })
})

describe('the operator request URL', () => {
  it('wraps a long URL, inverts its text on hover, restores on leave and opens the full URL', async () => {
    const mounted = await mountInput()
    const url = 'https://example.com/authorize?state=' + 'readable'.repeat(12)
    try {
      mounted.announce({ ...INPUT_REQUEST, description: 'A description long enough to have hidden the URL in the old single row card.', url })
      await mounted.flush()
      expect(mounted.setup.captureCharFrame().replace(/\s/g, '')).toContain(url)
      const region = mounted.setup.renderer.root.findDescendantById('operator-input-url')
      if (region === undefined) throw new Error('the URL was not rendered')
      const x = region.x + 3
      const y = region.y
      const urlSpans = () => mounted.setup.captureSpans().lines
        .slice(y, y + region.height)
        .flatMap((line) => line.spans)
        .filter((span) => span.text.trim().length > 0)
      const normal = urlSpans().map((span) => ({ text: span.text, fg: span.fg.toInts(), bg: span.bg.toInts() }))
      expect(urlSpans().every((span) => span.fg.equals(RGBA.fromHex(theme.accent)))).toBe(true)
      await act(async () => { await mounted.setup.mockMouse.moveTo(x, y) })
      await mounted.flush()
      expect(urlSpans().length).toBeGreaterThan(1)
      expect(urlSpans().every((span) => span.bg.equals(RGBA.fromHex(theme.accent)))).toBe(true)
      expect(urlSpans().every((span) => span.fg.equals(RGBA.fromHex('#000000')))).toBe(true)
      await act(async () => { await mounted.setup.mockMouse.moveTo(0, 0) })
      await mounted.flush()
      expect(urlSpans().map((span) => ({ text: span.text, fg: span.fg.toInts(), bg: span.bg.toInts() }))).toEqual(normal)
      await act(async () => { await mounted.setup.mockMouse.click(x, y) })
      await mounted.flush()
      expect(mounted.app.openedUrls).toEqual([url])
    } finally {
      await mounted.done()
    }
  })

  it('has no dead URL region for requests without a URL', async () => {
    const mounted = await mountInput()
    try {
      const { url: _url, ...request } = INPUT_REQUEST
      mounted.announce(request)
      await mounted.flush()
      expect(mounted.setup.renderer.root.findDescendantById('operator-input-url')).toBeUndefined()
    } finally {
      await mounted.done()
    }
  })
})
