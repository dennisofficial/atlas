import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ModelWaitCard, type ModelWaitCardProps } from '../model-wait-card'

const LONG_ACCOUNT = 'A-very-long-account-name-without-any-break-opportunities-at-all-1234567890'

const props: ModelWaitCardProps = {
  title: 'Waiting for model',
  announcement: 'Waiting for model',
  issues: [
    {
      id: 'one',
      detail: `Anthropic · ${LONG_ACCOUNT}: allowance exhausted. Provider reset: not supplied.`,
      meta: 'Last checked 2026-11-02 10:00 UTC',
      affectedLabel: '2 sessions waiting',
      affected: [
        { id: 'a', label: `explore · ${LONG_ACCOUNT}` },
        { id: 'b', label: 'This session' },
      ],
      actions: [
        {
          id: 'recheck',
          label: 'Recheck access',
          primary: true,
          disabled: false,
          onSelect: () => undefined,
        },
        {
          id: 'providers',
          label: 'Providers',
          primary: false,
          disabled: false,
          onSelect: () => undefined,
        },
      ],
    },
  ],
}

describe('ModelWaitCard at 320px and 375px', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })
  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  it('stacks the actions below sm, wraps long account text and lets the card shrink', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<ModelWaitCard {...props} />))

    const section = container.querySelector('section')
    expect(section?.className).toContain('min-w-0')
    const recheck = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Recheck access',
    )
    const row = recheck?.parentElement
    expect(row?.className).toContain('flex-col')
    expect(row?.className).toContain('sm:flex-row')
    const detail = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.includes(LONG_ACCOUNT),
    )
    expect(detail?.className).toContain('wrap-anywhere')
    for (const item of container.querySelectorAll('li')) {
      expect(item.className).toContain('wrap-anywhere')
      expect(item.className).toContain('min-w-0')
    }
    expect(container.querySelector('[class*="overflow-x"]')).toBeNull()
    expect(container.textContent).toContain('Recheck access')
    await act(async () => root.unmount())
  })
})
