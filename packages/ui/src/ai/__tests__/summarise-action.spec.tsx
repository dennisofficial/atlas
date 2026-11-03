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

const openMenu = async (node: React.ReactNode): Promise<HTMLElement[]> => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => createRoot(container).render(node))
  await act(async () =>
    document.body.querySelector<HTMLElement>('button[aria-label="Summarise"]')?.click(),
  )
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

describe('UserMessage summarise action', () => {
  it('offers only the directions it was given and runs the picked one', async () => {
    const picked: string[] = []
    const items = await openMenu(
      <UserMessage onSummariseUpTo={() => void picked.push('up-to')}>Earlier</UserMessage>,
    )

    expect(items.map((item) => item.textContent)).toEqual(['Summarise up to here'])
    await act(async () => items[0]?.click())
    expect(picked).toEqual(['up-to'])
  })

  it('lists up-to before from', async () => {
    const items = await openMenu(
      <UserMessage onSummariseUpTo={() => undefined} onSummariseFrom={() => undefined}>
        Middle
      </UserMessage>,
    )

    expect(items.map((item) => item.textContent)).toEqual([
      'Summarise up to here',
      'Summarise from here',
    ])
  })
})
