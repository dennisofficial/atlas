import { describe, expect, it } from 'bun:test'
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
