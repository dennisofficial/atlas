import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'

import { useExitPresence } from '../use-exit-presence'

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  await unregisterDom()
})

function Card({ open }: { open: boolean }) {
  const presence = useExitPresence<HTMLDivElement>(open)
  if (!presence.mounted) return null
  return (
    <div ref={presence.ref} data-closing={open ? undefined : true}>
      Card
    </div>
  )
}

const exitAnimation = () => {
  let finish: () => void = () => undefined
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  const original = HTMLElement.prototype.getAnimations
  HTMLElement.prototype.getAnimations = () => [{ finished } as unknown as Animation]
  return {
    finish,
    restore: () => {
      HTMLElement.prototype.getAnimations = original
    },
  }
}

describe('useExitPresence', () => {
  it('renders nothing while closed from the start', async () => {
    await act(async () => root.render(<Card open={false} />))
    expect(container.innerHTML).toBe('')
  })

  it('keeps the element mounted until its exit animation finishes', async () => {
    const animation = exitAnimation()
    await act(async () => root.render(<Card open />))
    await act(async () => root.render(<Card open={false} />))
    expect(container.querySelector('[data-closing]')?.textContent).toBe('Card')
    await act(async () => animation.finish())
    expect(container.innerHTML).toBe('')
    animation.restore()
  })

  it('stays mounted when reopened during the exit', async () => {
    const animation = exitAnimation()
    await act(async () => root.render(<Card open />))
    await act(async () => root.render(<Card open={false} />))
    await act(async () => root.render(<Card open />))
    await act(async () => animation.finish())
    expect(container.textContent).toBe('Card')
    expect(container.querySelector('[data-closing]')).toBeNull()
    animation.restore()
  })

  it('unmounts at once when nothing animates', async () => {
    await act(async () => root.render(<Card open />))
    await act(async () => root.render(<Card open={false} />))
    expect(container.innerHTML).toBe('')
  })
})
