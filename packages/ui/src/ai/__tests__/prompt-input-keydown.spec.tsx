import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { PromptInput } from '../prompt-input'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const enter = (area: HTMLTextAreaElement) =>
  act(async () => {
    area.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
  })

const mount = async (element: React.ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  const area = container.querySelector('textarea')
  if (area === null) throw new Error('no textarea')
  return { area, unmount: () => act(async () => root.unmount()) }
}

describe('PromptInput textarea key handler', () => {
  it('runs first and a prevented event does not submit', async () => {
    const submitted: string[] = []
    const { area, unmount } = await mount(
      <PromptInput
        defaultValue="hi"
        onSubmit={(text) => void submitted.push(text)}
        onTextareaKeyDown={(event) => event.preventDefault()}
      />,
    )
    await enter(area)
    expect(submitted).toEqual([])
    await unmount()
  })

  it('still submits on Enter when the handler leaves the event alone', async () => {
    const submitted: string[] = []
    const { area, unmount } = await mount(
      <PromptInput defaultValue="hi" onSubmit={(text) => void submitted.push(text)} />,
    )
    await enter(area)
    expect(submitted).toEqual(['hi'])
    await unmount()
  })
})
