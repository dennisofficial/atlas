import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { StartFailedCard } from '../start-failed-card'

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

const retryButton = () =>
  Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent === 'Retry',
  )

describe('StartFailedCard', () => {
  it('shows the title and the reason', async () => {
    await mount(<StartFailedCard reason="no capacity" onRetry={() => Promise.resolve()} />)
    expect(document.body.textContent).toContain("Atlas couldn't start this session")
    expect(document.body.textContent).toContain('no capacity')
  })

  it('omits the reason when there is none', async () => {
    await mount(<StartFailedCard reason={undefined} onRetry={() => Promise.resolve()} />)
    expect(document.body.textContent).toBe("Atlas couldn't start this sessionRetry")
  })

  it('calls retry once and disables the button while it is in flight', async () => {
    let calls = 0
    let finish: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    await mount(
      <StartFailedCard
        reason="x"
        onRetry={() => {
          calls += 1
          return pending
        }}
      />,
    )
    await act(async () => retryButton()?.click())
    await act(async () => retryButton()?.click())
    expect(calls).toBe(1)
    expect(retryButton()?.disabled).toBe(true)
    await act(async () => finish())
    expect(retryButton()?.disabled).toBe(false)
  })
})
