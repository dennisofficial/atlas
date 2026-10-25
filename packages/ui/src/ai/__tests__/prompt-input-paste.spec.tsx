import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act, useState } from 'react'

import { PromptInput } from '../prompt-input'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function ControlledComposer({ initial, sending = false }: { initial: string; sending?: boolean }) {
  const [draft, setDraft] = useState(initial)
  return (
    <PromptInput value={draft} onValueChange={setDraft} sending={sending} clearOnSubmit={false} />
  )
}

const pasteInto = (args: { field: HTMLTextAreaElement; data: Record<string, string> }) => {
  const clipboard = new DataTransfer()
  for (const [type, value] of Object.entries(args.data)) clipboard.setData(type, value)
  const event = new ClipboardEvent('paste', {
    clipboardData: clipboard,
    bubbles: true,
    cancelable: true,
  })
  args.field.dispatchEvent(event)
  return event
}

const mount = async (element: React.ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  const field = container.querySelector('textarea')
  if (field === null) throw new Error('composer textarea did not render')
  return { field, unmount: () => act(async () => root.unmount()) }
}

describe('PromptInput paste', () => {
  it('inserts the text the paste event carries at the caret', async () => {
    const { field, unmount } = await mount(<ControlledComposer initial="ab" />)
    field.focus()
    field.setSelectionRange(1, 1)

    let event: ClipboardEvent | undefined
    await act(async () => {
      event = pasteInto({ field, data: { 'text/plain': 'Good job. ' } })
    })

    expect(event?.defaultPrevented).toBe(true)
    expect(field.value).toBe('aGood job. b')
    expect(field.selectionStart).toBe('aGood job. '.length)
    await unmount()
  })

  it('replaces the selected text', async () => {
    const { field, unmount } = await mount(<ControlledComposer initial="fix the build" />)
    field.focus()
    field.setSelectionRange(8, 13)

    await act(async () => {
      pasteInto({ field, data: { 'text/plain': 'tests' } })
    })

    expect(field.value).toBe('fix the tests')
    await unmount()
  })

  it('leaves a paste without text to the browser', async () => {
    const { field, unmount } = await mount(<ControlledComposer initial="" />)

    let event: ClipboardEvent | undefined
    await act(async () => {
      event = pasteInto({ field, data: { 'image/png': 'binary' } })
    })

    expect(event?.defaultPrevented).toBe(false)
    expect(field.value).toBe('')
    await unmount()
  })

  it('ignores a paste while the message is sending', async () => {
    const { field, unmount } = await mount(<ControlledComposer initial="sent" sending />)

    await act(async () => {
      pasteInto({ field, data: { 'text/plain': 'more' } })
    })

    expect(field.value).toBe('sent')
    await unmount()
  })
})
