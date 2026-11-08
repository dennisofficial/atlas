import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { RefusalRows } from '../refusal-rows'

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
}

describe('RefusalRows', () => {
  it('renders one alert per refusal with its reason', async () => {
    await mount(
      <RefusalRows
        refusals={[
          { inboxId: 1, reason: 'Nothing to rewind to' },
          { inboxId: 2, reason: 'Summary is already in place' },
        ]}
      />,
    )
    const alerts = Array.from(document.body.querySelectorAll('[role="alert"]')).map(
      (node) => node.textContent,
    )
    expect(alerts).toEqual(['Nothing to rewind to', 'Summary is already in place'])
    expect(document.body.querySelector('[aria-label="Refused commands"]')).not.toBeNull()
  })

  it('renders nothing for an empty list', async () => {
    await mount(<RefusalRows refusals={[]} />)
    expect(document.body.textContent).toBe('')
  })

  it('renders nothing without refusals', async () => {
    await mount(<RefusalRows refusals={undefined} />)
    expect(document.body.textContent).toBe('')
  })
})
