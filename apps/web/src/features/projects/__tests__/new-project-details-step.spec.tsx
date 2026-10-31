import { describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'

import { DetailsStep } from '../new-project-details-step'
import { emptyDraft } from '../new-project-draft'

describe('DetailsStep', () => {
  it('asks for a name and description without an owner picker', () => {
    const html = renderToStaticMarkup(
      <DetailsStep draft={emptyDraft()} patch={() => undefined} nameError={null} />,
    )
    expect(html).toContain('Name')
    expect(html).toContain('Description')
    expect(html).not.toContain('Owner')
    expect(html).not.toContain('radiogroup')
  })
})

describe('DetailsStep with a repository', () => {
  it('offers additional repositories and secrets without runtime settings', () => {
    const draft = { ...emptyDraft(), repo: 'compai/csa' }
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <DetailsStep draft={draft} patch={() => undefined} nameError={null} />
      </QueryClientProvider>,
    )
    expect(html).not.toContain('When a thread ships')
    expect(html).not.toContain('Sandbox size')
    expect(html).not.toContain('Setup script')
    expect(html).toContain('Secrets &amp; Env Vars')
    expect(html).toContain('Paste .env')
    expect(html).toContain('Additional repositories')
    expect(html).toContain('Add repository')
  })
})
