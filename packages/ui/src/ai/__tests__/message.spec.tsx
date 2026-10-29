import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { UserMessage } from '../message'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('UserMessage', () => {
  it('calls onRewind from the user message action', async () => {
    let rewound = 0
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(<UserMessage onRewind={() => void (rewound += 1)}>Try again</UserMessage>),
    )

    await act(async () => {
      document.body
        .querySelector('button[aria-label="Rewind to here"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(rewound).toBe(1)
  })

  it('shows pasted images, with no empty bubble when there is no text', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <UserMessage images={[{ id: 'i1', src: 'data:image/png;base64,aGk=', alt: 'shot.png' }]} />,
      ),
    )

    expect(container.querySelector('img[alt="shot.png"]')?.getAttribute('src')).toBe(
      'data:image/png;base64,aGk=',
    )
    expect(container.querySelector('[data-slot="bubble"]')).toBeNull()
  })
})
