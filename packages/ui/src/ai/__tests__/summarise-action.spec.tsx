import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { UserMessage } = await import('../message')

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('UserMessage summarise action', () => {
  it('runs summarise up to here straight from its button', async () => {
    const { createRoot } = await import('react-dom/client')
    const picked: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () =>
      createRoot(container).render(
        <UserMessage onSummariseUpTo={() => void picked.push('up-to')}>Earlier</UserMessage>,
      ),
    )

    await act(async () =>
      document.body
        .querySelector<HTMLElement>('button[aria-label="Summarise up to here"]')
        ?.click(),
    )

    expect(picked).toEqual(['up-to'])
    expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(0)
  })
})
