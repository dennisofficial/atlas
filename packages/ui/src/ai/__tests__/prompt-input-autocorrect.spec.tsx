import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { PromptInput } from '../prompt-input'

afterEach(async () => {
  await GlobalRegistrator.unregister()
})

describe('PromptInput autocorrect', () => {
  it.each([
    { width: 390, autocorrect: 'on' },
    { width: 767, autocorrect: 'on' },
    { width: 768, autocorrect: 'off' },
    { width: 1280, autocorrect: 'off' },
  ])(
    'sets autocorrect to $autocorrect at $width px without disabling spellcheck',
    async ({ width, autocorrect }) => {
      GlobalRegistrator.register({ width })
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
      const { createRoot } = await import('react-dom/client')
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)

      try {
        await act(async () => root.render(<PromptInput />))
        const field = container.querySelector('textarea')
        if (field === null) throw new Error('composer textarea did not render')

        expect(field.getAttribute('autocorrect')).toBe(autocorrect)
        expect(field.getAttribute('spellcheck')).not.toBe('false')
      } finally {
        await act(async () => root.unmount())
        container.remove()
      }
    },
  )
})
