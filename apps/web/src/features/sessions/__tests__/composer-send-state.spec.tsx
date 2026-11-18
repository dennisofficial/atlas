import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement, useState } from 'react'

import { ThreadComposer } from '@/features/threads/thread-composer'

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

const DRAFT = 'fix the flaky checkout test'

function deferred() {
  let settle: (failure: unknown) => void = () => undefined
  const promise = new Promise<void>((resolve, reject) => {
    settle = (failure) => (failure === undefined ? resolve() : reject(failure))
  })
  return { promise, settle }
}

function SendHarness({ post }: { post: () => Promise<void> }) {
  const [draft, setDraft] = useState(DRAFT)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const handleSubmit = async () => {
    setSending(true)
    try {
      await post()
      setDraft('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSending(false)
    }
  }
  return (
    <>
      <p data-slot="error">{error}</p>
      <ThreadComposer
        value={draft}
        onValueChange={setDraft}
        onSubmit={() => void handleSubmit()}
        sending={sending}
      />
    </>
  )
}

const field = () => document.body.querySelector<HTMLTextAreaElement>('textarea')
const buttonLabelled = (label: string) =>
  document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const sendsLine = () => document.body.querySelector('span[role="status"]')?.textContent?.trim()
const errorLine = () => document.body.querySelector('[data-slot="error"]')?.textContent

const submitDraft = async () => {
  const form = document.body.querySelector('form')
  if (form === null) throw new Error('no composer form')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('composer send state', () => {
  it('disables the composer with Sending… while the post is in flight', async () => {
    const post = deferred()
    const unmount = await mount(<SendHarness post={() => post.promise} />)

    await submitDraft()

    expect(field()?.readOnly).toBe(true)
    expect(sendsLine()).toBe('Sending…')
    expect(buttonLabelled('Sending')?.disabled).toBe(true)
    expect(buttonLabelled('Attach files')?.disabled).toBe(true)
    expect(field()?.value).toBe(DRAFT)
    await unmount()
  })

  it('re-enables the composer with the text kept when the post fails', async () => {
    const post = deferred()
    const unmount = await mount(<SendHarness post={() => post.promise} />)

    await submitDraft()
    expect(sendsLine()).toBe('Sending…')

    await act(async () => {
      post.settle(new Error('network unreachable'))
      await post.promise.catch(() => undefined)
    })

    expect(field()?.readOnly).toBe(false)
    expect(field()?.value).toBe(DRAFT)
    expect(sendsLine()).toBeUndefined()
    expect(buttonLabelled('Send')?.disabled).toBe(false)
    expect(buttonLabelled('Attach files')?.disabled).toBe(false)
    expect(errorLine()).toBe('network unreachable')
    await unmount()
  })
})
