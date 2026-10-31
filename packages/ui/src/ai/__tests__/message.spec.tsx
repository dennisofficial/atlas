import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { ReactNode } from 'react'

import { AgentMessage, UserMessage } from '../message'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const render = async (node: ReactNode): Promise<HTMLElement> => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(node))
  return container
}

const footerOf = (container: HTMLElement) => container.querySelector('[data-slot="message-footer"]')

const footerLabels = (container: HTMLElement): string[] =>
  [...(footerOf(container)?.querySelectorAll('button, span') ?? [])].map(
    (element) => element.getAttribute('aria-label') ?? element.textContent ?? '',
  )

const installClipboard = () => {
  const written: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text)
        return Promise.resolve()
      },
    },
  })
  return written
}

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

describe('UserMessage footer', () => {
  it('copies the raw text, not the rendered children', async () => {
    const written = installClipboard()
    const raw = '  **bold** and `code`\n'
    const container = await render(<UserMessage copyText={raw}>rendered markdown</UserMessage>)

    await act(async () => {
      container
        .querySelector('button[aria-label="Copy"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(written).toEqual([raw])
    expect(container.querySelector('button[aria-label="Copied"]')).not.toBeNull()
  })

  it('offers no copy for missing or whitespace-only text', async () => {
    const image = [{ id: 'i1', src: 'data:image/png;base64,aGk=', alt: 'shot.png' }]
    const imageOnly = await render(<UserMessage images={image} copyText="" />)
    expect(imageOnly.querySelector('button[aria-label="Copy"]')).toBeNull()
    expect(footerOf(imageOnly)).toBeNull()

    const blank = await render(<UserMessage images={image} copyText={'  \n '} />)
    expect(blank.querySelector('button[aria-label="Copy"]')).toBeNull()
  })

  it('orders time, then edit, copy and rewind', async () => {
    const container = await render(
      <UserMessage timestamp="2:05 PM" copyText="hi" onEdit={() => {}} onRewind={() => {}}>
        hi
      </UserMessage>,
    )

    expect(footerLabels(container)).toEqual(['2:05 PM', 'Edit', 'Copy', 'Rewind to here'])
  })

  it('renders a time-only footer without actions', async () => {
    const container = await render(<UserMessage timestamp="9:30 AM">hi</UserMessage>)

    expect(footerLabels(container)).toEqual(['9:30 AM'])
    expect(container.querySelector('button')).toBeNull()
  })

  it('keeps the speaker name out of the visible text', async () => {
    const container = await render(
      <UserMessage author="Dennis" timestamp="9:30 AM">
        hi
      </UserMessage>,
    )

    expect(container.querySelector('[data-slot="message-header"]')).toBeNull()
    const name = [...container.querySelectorAll('span')].find((el) => el.textContent === 'Dennis')
    expect(name?.className).toContain('sr-only')
  })
})

describe('AgentMessage footer', () => {
  it('orders copy, feedback and retry, then the timestamp', async () => {
    const container = await render(
      <AgentMessage
        author="Atlas"
        timestamp="2:05 PM"
        copyText="done"
        onFeedback={() => {}}
        onRetry={() => {}}
      >
        done
      </AgentMessage>,
    )

    expect(footerLabels(container)).toEqual([
      'Copy',
      'Good response',
      'Bad response',
      'Retry',
      '2:05 PM',
    ])
    expect(container.querySelector('[data-slot="message-header"]')).toBeNull()
  })

  it('hides actions while streaming but keeps the timestamp', async () => {
    const container = await render(
      <AgentMessage streaming timestamp="2:05 PM" copyText="partial" onRetry={() => {}}>
        partial
      </AgentMessage>,
    )

    expect(footerLabels(container)).toEqual(['2:05 PM'])
    expect(container.querySelector('button')).toBeNull()
  })

  it('has no footer without a timestamp or actions', async () => {
    const container = await render(<AgentMessage streaming>partial</AgentMessage>)

    expect(footerOf(container)).toBeNull()
  })
})
