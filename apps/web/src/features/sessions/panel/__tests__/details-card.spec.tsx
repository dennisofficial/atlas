import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

import { contextMirrorKey } from '../../data/context-files'
import { SessionDetailsCard } from '../details-card'
import { SessionCheckoutScope } from '../checkout-scope'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { populatedPaneValue } from './fixture'

const render = (open: boolean, value: SessionPaneValue = populatedPaneValue()): string => {
  const client = createTestQueryClient()
  client.setQueryData(contextMirrorKey(value.sessionId), { files: [] })
  return renderToStaticMarkup(
    <TestQueryProvider client={client}>
      <SessionPaneProvider value={value}>
        <SessionCheckoutScope>
          <SessionDetailsCard open={open} onOpenChanges={() => undefined} />
        </SessionCheckoutScope>
      </SessionPaneProvider>
    </TestQueryProvider>,
  )
}

describe('SessionDetailsCard', () => {
  it('floats the session details in a card of its own', () => {
    const html = render(true)
    expect(html).toContain('data-session-details-card')
    expect(html).toContain('data-session-details')
    expect(html).not.toContain('Rebase ui on shadcn base-nova')
    expect(html).not.toContain('data-session-state')
    expect(html).toContain('data-details-changes')
  })

  it('renders nothing while the card is closed', () => {
    expect(render(false)).toBe('')
  })
})
