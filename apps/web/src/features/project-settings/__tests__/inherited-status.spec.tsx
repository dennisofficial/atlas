import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { EQueryState } from '@/lib/use-cloud-query'

import { InheritedStatus } from '../inherited-status'

describe('InheritedStatus', () => {
  it('renders nothing once the workspace values are ready, empty or not', () => {
    expect(
      renderToStaticMarkup(
        <InheritedStatus inherited={{ state: EQueryState.Ready, secrets: [] }} />,
      ),
    ).toBe('')
  })

  it('shows a loading line while the workspace values load', () => {
    const html = renderToStaticMarkup(
      <InheritedStatus inherited={{ state: EQueryState.Loading }} />,
    )
    expect(html).toContain('Loading workspace values')
  })

  it('shows an alert with Retry when the workspace values fail', () => {
    const html = renderToStaticMarkup(
      <InheritedStatus
        inherited={{ state: EQueryState.Failed, message: 'down', retry: () => undefined }}
      />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('down')
    expect(html).toContain('Retry')
  })
})
