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

const mount = async (element: React.ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  const area = container.querySelector('textarea')
  if (area === null) throw new Error('composer textarea did not render')
  return { area, unmount: () => act(async () => root.unmount()) }
}

const press = async (area: HTMLTextAreaElement, key: string): Promise<boolean> => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => {
    area.dispatchEvent(event)
  })
  return event.defaultPrevented
}

const seed = (area: HTMLTextAreaElement, value: string) => {
  area.value = value
  area.setSelectionRange(value.length, value.length)
}

const typeHyphen = async (area: HTMLTextAreaElement) => {
  const start = area.selectionStart
  if (await press(area, '-')) return
  area.value = `${area.value.slice(0, start)}-${area.value.slice(area.selectionEnd)}`
  area.setSelectionRange(start + 1, start + 1)
}

describe('PromptInput literal hyphens', () => {
  it('takes over the second hyphen so the webview cannot make the run a dash', async () => {
    const { area, unmount } = await mount(<PromptInput defaultValue="| " />)

    seed(area, '| -')
    const prevented = await press(area, '-')

    expect(prevented).toBe(true)
    expect(area.value).toBe('| --')
    await unmount()
  })

  it('types a whole delimiter cell as hyphens', async () => {
    const { area, unmount } = await mount(<PromptInput defaultValue="| " />)

    seed(area, '| ')
    await typeHyphen(area)
    await typeHyphen(area)
    await typeHyphen(area)

    expect(area.value).toBe('| ---')
    expect(area.selectionStart).toBe(5)
    await unmount()
  })

  it('hands the literal text to the owner', async () => {
    const seen: string[] = []
    const { area, unmount } = await mount(
      <PromptInput defaultValue="--" onValueChange={(next) => void seen.push(next)} />,
    )

    seed(area, '--')
    await press(area, '-')

    expect(seen).toEqual(['---'])
    await unmount()
  })

  it('leaves a hyphen after other text to the webview', async () => {
    const { area, unmount } = await mount(<PromptInput defaultValue="a" />)

    seed(area, 'a')
    const prevented = await press(area, '-')

    expect(prevented).toBe(false)
    expect(area.value).toBe('a')
    await unmount()
  })

  it('leaves a hyphen typed after an existing em dash alone', async () => {
    const { area, unmount } = await mount(<PromptInput defaultValue="—" />)

    seed(area, '—')
    const prevented = await press(area, '-')

    expect(prevented).toBe(false)
    await unmount()
  })
})
