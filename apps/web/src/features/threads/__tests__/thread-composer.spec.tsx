import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { ThreadComposer } from '../thread-composer'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return () => act(async () => root.unmount())
}

const buttonLabelled = (label: string) =>
  document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const composer = (props: { value?: string; working?: boolean; onStop?: () => void }) => (
  <ThreadComposer
    value={props.value ?? ''}
    onValueChange={() => undefined}
    onSubmit={() => undefined}
    sending={false}
    {...(props.working === undefined ? {} : { working: props.working })}
    {...(props.onStop === undefined ? {} : { onStop: props.onStop })}
  />
)

describe('ThreadComposer', () => {
  it('renders the stop button while working and calls onStop', async () => {
    let stops = 0
    const unmount = await mount(composer({ working: true, onStop: () => void (stops += 1) }))

    const stop = buttonLabelled('Stop')
    expect(stop).not.toBeNull()
    await act(async () => {
      stop?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(stops).toBe(1)
    await unmount()
  })

  it('renders no stop button when working is undefined or false', async () => {
    const omitted = await mount(composer({}))
    expect(buttonLabelled('Stop')).toBeNull()
    await omitted()

    const idle = await mount(composer({ working: false, onStop: () => undefined }))
    expect(buttonLabelled('Stop')).toBeNull()
    await idle()
  })

  it('keeps the send button usable while working (queue-while-busy)', async () => {
    const unmount = await mount(
      composer({ value: 'queue this', working: true, onStop: () => undefined }),
    )

    expect(buttonLabelled('Stop')).not.toBeNull()
    expect(buttonLabelled('Send')?.disabled).toBe(false)
    await unmount()
  })
})
