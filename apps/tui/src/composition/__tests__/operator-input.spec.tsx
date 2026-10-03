import { toThreadId } from '@dltech/atlas-core'
import { EClientRequest, type OperatorInputAnswerOutcome } from '@dltech/atlas-harness'
import { describe, expect, it, mock } from 'bun:test'

import { operatorEditorText } from '../../ui/operator-input-text'
import { INPUT_REQUEST, MULTILINE, deliveryGate, mountInput } from './operator-input-fixture'

async function paste(mounted: Awaited<ReturnType<typeof mountInput>>, value: string) {
  mounted.announce()
  await mounted.flush()
  await mounted.input.pasteBracketedText(value)
  await mounted.flush()
}

const send = (mounted: Awaited<ReturnType<typeof mountInput>>) =>
  mounted.input.pressKey('s', { ctrl: true })

describe('native operator input', () => {
  it('preserves a >10KB multiline paste and the composer, including repeated request signals', async () => {
    const mounted = await mountInput()
    try {
      expect(Buffer.byteLength(MULTILINE)).toBeGreaterThan(10_000)
      await paste(mounted, MULTILINE)
      expect(mounted.control().editor.current?.plainText).toBe(operatorEditorText(MULTILINE))
      expect(mounted.control().state?.typed).toBe(MULTILINE)
      expect(mounted.composerText()).toBe('composer stays here')
      expect(mounted.setup.captureCharFrame()).not.toContain('[Pasted text')
      mounted.announce()
      await mounted.flush()
      expect(mounted.control().editor.current?.plainText).toBe(operatorEditorText(MULTILINE))
      expect(mounted.control().state?.typed).toBe(MULTILINE)
      mounted.clear()
      await mounted.flush()
      expect(mounted.control().state).toBeNull()
      expect(mounted.composerText()).toBe('composer stays here')
    } finally {
      await mounted.done()
    }
  })

  it('inserts Enter as a newline and uses native cursor editing, not append-only key handling', async () => {
    const mounted = await mountInput()
    const answer = mock(async () => ({ ok: true, bytes: 0 } as const))
    mounted.app.operatorInput.answer = answer
    try {
      await paste(mounted, '  first')
      mounted.input.pressEnter()
      await mounted.flush()
      await mounted.input.typeText('second  ')
      mounted.input.pressArrow('left')
      mounted.input.pressBackspace()
      await mounted.flush()
      expect(mounted.control().editor.current?.plainText).toBe('  first\nsecond ')
      expect(answer).not.toHaveBeenCalled()
      expect(mounted.composerText()).toBe('composer stays here')
    } finally {
      await mounted.done()
    }
  })

  it('awaits actual local delivery on Ctrl+S and does not submit twice', async () => {
    const mounted = await mountInput()
    const gate = deliveryGate<OperatorInputAnswerOutcome>()
    const answer = mock((_args: { requestId: string; value: string }) => gate.promise)
    mounted.app.operatorInput.answer = answer
    try {
      await paste(mounted, MULTILINE)
      send(mounted)
      send(mounted)
      await mounted.flush()
      expect(answer).toHaveBeenCalledTimes(1)
      expect(answer).toHaveBeenCalledWith({ requestId: INPUT_REQUEST.requestId, value: MULTILINE })
      expect(mounted.control().state?.kind).toBe('delivering')
      expect(mounted.setup.captureCharFrame()).toContain('delivering')
      mounted.announce()
      await mounted.flush()
      expect(mounted.control().state?.kind).toBe('delivering')
      expect(mounted.control().editor.current?.plainText).toBe(operatorEditorText(MULTILINE))
      gate.resolve({ ok: true, bytes: Buffer.byteLength(MULTILINE) })
      mounted.clear()
      await mounted.flush()
      expect(mounted.control().state).toBeNull()
      expect(mounted.composerText()).toBe('composer stays here')
    } finally {
      gate.resolve({ ok: false, reason: 'test ended' })
      await mounted.done()
    }
  })

  it('sends whitespace-only answers exactly without adding the optional server-side newline', async () => {
    const mounted = await mountInput()
    const answer = mock(async (_args: { requestId: string; value: string }) => ({ ok: true, bytes: 4 } as const))
    mounted.app.operatorInput.answer = answer
    try {
      await paste(mounted, ' \t\n ')
      send(mounted)
      await mounted.flush()
      expect(answer).toHaveBeenCalledWith({ requestId: INPUT_REQUEST.requestId, value: ' \t\n ' })
    } finally {
      await mounted.done()
    }
  })

  it('explicitly interrupts on Escape both before and during delivery without dismissing the request', async () => {
    const mounted = await mountInput()
    const gate = deliveryGate<OperatorInputAnswerOutcome>()
    const answer = mock(() => gate.promise)
    mounted.app.operatorInput.answer = answer
    try {
      await paste(mounted, 'answer')
      mounted.input.pressEscape()
      await mounted.flush()
      expect(mounted.interrupts()).toBe(1)
      expect(mounted.control().state?.kind).toBe('awaiting')
      expect(answer).not.toHaveBeenCalled()
      send(mounted)
      await mounted.flush()
      mounted.input.pressEscape()
      await mounted.flush()
      expect(mounted.interrupts()).toBe(2)
      expect(mounted.control().state?.kind).toBe('delivering')
      mounted.clear()
      gate.reject(new Error('interrupted'))
      await mounted.flush()
      expect(mounted.control().state).toBeNull()
    } finally {
      gate.resolve({ ok: false, reason: 'test ended' })
      await mounted.done()
    }
  })

  it('keeps the exact draft and re-enables editing after a local transport error', async () => {
    const mounted = await mountInput()
    const answer = mock(async () => { throw new Error('local transport lost') })
    mounted.app.operatorInput.answer = answer
    try {
      await paste(mounted, MULTILINE)
      send(mounted)
      await mounted.flush()
      expect(mounted.control().state).toMatchObject({ kind: 'awaiting', typed: MULTILINE, failure: 'local transport lost' })
      expect(mounted.control().editor.current?.plainText).toBe(operatorEditorText(MULTILINE))
      expect(mounted.control().editor.current?.focused).toBe(true)
      expect(mounted.setup.captureCharFrame()).toContain('local transport lost')
      await mounted.input.typeText('!')
      send(mounted)
      await mounted.flush()
      expect(answer).toHaveBeenCalledTimes(2)
      expect(mounted.control().state?.typed).toBe(MULTILINE + '!')
    } finally {
      await mounted.done()
    }
  })

  it('does not resurrect a card after switching threads while a delivery fails', async () => {
    const mounted = await mountInput()
    const gate = deliveryGate<OperatorInputAnswerOutcome>()
    mounted.app.operatorInput.answer = () => gate.promise
    try {
      await paste(mounted, 'answer')
      send(mounted)
      await mounted.flush()
      mounted.switchThread(toThreadId('other-thread'))
      await mounted.flush()
      gate.resolve({ ok: false, reason: 'late failure' })
      await mounted.flush()
      expect(mounted.control().state).toBeNull()
    } finally {
      gate.resolve({ ok: false, reason: 'test ended' })
      await mounted.done()
    }
  })

  it('uses the remote delivery request instead of the local port and preserves the same text', async () => {
    const gate = deliveryGate<unknown>()
    const request = mock((_args: { op: EClientRequest; params?: unknown }) => gate.promise)
    const mounted = await mountInput({ remote: request })
    const localAnswer = mock(async () => ({ ok: false, reason: 'must not run locally' } as const))
    mounted.app.operatorInput.answer = localAnswer
    try {
      await paste(mounted, MULTILINE)
      send(mounted)
      await mounted.flush()
      expect(request).toHaveBeenCalledWith({
        op: EClientRequest.ProvideOperatorInput,
        params: { requestId: INPUT_REQUEST.requestId, value: MULTILINE },
      })
      expect(localAnswer).not.toHaveBeenCalled()
      expect(mounted.control().state?.kind).toBe('delivering')
      gate.resolve({ delivered: true, bytes: Buffer.byteLength(MULTILINE) })
      mounted.clear()
      await mounted.flush()
      expect(mounted.control().state).toBeNull()
      expect(mounted.composerText()).toBe('composer stays here')
    } finally {
      gate.resolve({ delivered: false, bytes: 0 })
      await mounted.done()
    }
  })

  it.each([
    ['request failure', async () => { throw new Error('socket lost') }, 'socket lost'],
    ['malformed reply', async () => ({}), 'delivered'],
  ])('restores the remote draft after %s', async (_name, remote, failure) => {
    const mounted = await mountInput({ remote })
    try {
      await paste(mounted, MULTILINE)
      send(mounted)
      await mounted.flush()
      expect(mounted.control().state?.kind).toBe('awaiting')
      const state = mounted.control().state
      if (state?.kind !== 'awaiting') throw new Error('the input did not return to editing')
      expect(state.failure).toContain(failure)
      expect(state.typed).toBe(MULTILINE)
      expect(mounted.control().editor.current?.plainText).toBe(operatorEditorText(MULTILINE))
    } finally {
      await mounted.done()
    }
  })

  it('does not resurrect a consumed request when local destination failure arrives after null', async () => {
    const mounted = await mountInput()
    const gate = deliveryGate<OperatorInputAnswerOutcome>()
    mounted.app.operatorInput.answer = () => gate.promise
    try {
      await paste(mounted, MULTILINE)
      send(mounted)
      await mounted.flush()
      mounted.clear()
      gate.resolve({ ok: false, reason: 'destination unavailable' })
      await mounted.flush()
      expect(mounted.control().state).toBeNull()
      expect(mounted.composerText()).toBe('composer stays here')
    } finally {
      gate.resolve({ ok: false, reason: 'test ended' })
      await mounted.done()
    }
  })

  it('does not offer a same-request retry after the sandbox reports undelivered', async () => {
    const mounted = await mountInput({ remote: async () => ({ delivered: false, bytes: 0 }) })
    try {
      await paste(mounted, MULTILINE)
      send(mounted)
      await mounted.flush()
      expect(mounted.control().state).toBeNull()
      expect(mounted.composerText()).toBe('composer stays here')
    } finally {
      await mounted.done()
    }
  })

  it('pastes into native Unicode selections while retaining the original surrounding newline bytes', async () => {
    const mounted = await mountInput()
    try {
      await paste(mounted, 'a界🙂\r\nsecond\rthird')
      const editor = mounted.control().editor.current
      if (editor === null) throw new Error('the editor did not mount')
      editor.setSelection(1, 5)
      await mounted.input.pasteBracketedText(' x\r\ny ')
      await mounted.flush()
      expect(mounted.control().state?.typed).toBe('a x\r\ny \r\nsecond\rthird')
      expect(editor.plainText).toBe('a x\ny \nsecond\nthird')
      expect(mounted.composerText()).toBe('composer stays here')
    } finally {
      await mounted.done()
    }
  })

  it('shows a channel failure instead of falling back to local delivery for a cloud turn', async () => {
    const mounted = await mountInput({ cloud: true })
    try {
      await paste(mounted, 'answer')
      send(mounted)
      await mounted.flush()
      expect(mounted.control().state).toMatchObject({ kind: 'awaiting', failure: 'the channel to the sandbox is not open' })
    } finally {
      await mounted.done()
    }
  })
})
