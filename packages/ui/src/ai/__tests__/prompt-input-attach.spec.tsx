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
  const form = container.querySelector('form')
  if (form === null) throw new Error('composer form did not render')
  return { container, form, unmount: () => act(async () => root.unmount()) }
}

// happy-dom's DragEvent ignores dataTransfer in its init and its DataTransfer.types omits 'Files'
const dragEvent = (args: { type: 'dragover' | 'drop'; files: File[] }) => {
  const event = new Event(args.type, { bubbles: true, cancelable: true })
  const dataTransfer = { files: args.files, types: args.files.length > 0 ? ['Files'] : [] }
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

const shot = () => new File(['pixels'], 'shot.png', { type: 'image/png' })

describe('PromptInput file attachment', () => {
  it('attaches dropped files', async () => {
    const attached: File[][] = []
    const { form, unmount } = await mount(<PromptInput onAttachFiles={(f) => attached.push(f)} />)
    const file = shot()

    const event = dragEvent({ type: 'drop', files: [file] })
    await act(async () => {
      form.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(attached).toEqual([[file]])
    await unmount()
  })

  it('accepts a drag that carries files', async () => {
    const { form, unmount } = await mount(<PromptInput onAttachFiles={() => {}} />)

    const event = dragEvent({ type: 'dragover', files: [shot()] })
    await act(async () => {
      form.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    await unmount()
  })

  it('ignores a drag without files', async () => {
    const { form, unmount } = await mount(<PromptInput onAttachFiles={() => {}} />)

    const event = dragEvent({ type: 'dragover', files: [] })
    await act(async () => {
      form.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
    await unmount()
  })

  it('ignores drops while sending', async () => {
    const attached: File[][] = []
    const { form, unmount } = await mount(
      <PromptInput sending onAttachFiles={(f) => attached.push(f)} />,
    )

    const event = dragEvent({ type: 'drop', files: [shot()] })
    await act(async () => {
      form.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
    expect(attached).toEqual([])
    await unmount()
  })

  it('ignores drops without an attach handler', async () => {
    const { form, unmount } = await mount(<PromptInput />)

    const event = dragEvent({ type: 'drop', files: [shot()] })
    await act(async () => {
      form.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
    await unmount()
  })

  it('renders a thumbnail for an attachment with a preview url', async () => {
    const { container, unmount } = await mount(
      <PromptInput
        attachments={[
          { id: '1', name: 'shot.png', previewUrl: 'blob:preview-1' },
          { id: '2', name: 'build.log' },
        ]}
      />,
    )

    const images = container.querySelectorAll('img')
    expect(images).toHaveLength(1)
    expect(images[0]?.getAttribute('src')).toBe('blob:preview-1')
    expect(images[0]?.closest('[data-variant="image"]')).not.toBeNull()
    await unmount()
  })

  it('forwards accept to the file input', async () => {
    const { container, unmount } = await mount(<PromptInput accept="image/*" />)

    const input = container.querySelector('input[type="file"]')
    expect(input?.getAttribute('accept')).toBe('image/*')
    expect(input?.hasAttribute('multiple')).toBe(true)
    await unmount()
  })
})
