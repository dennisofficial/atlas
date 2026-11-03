import { describe, expect, it } from 'bun:test'

import { OutputShapeFragment } from '../fragments/output'

describe('the output shape fragment', () => {
  it('tells the model the client renders mermaid fences as diagrams', () => {
    const text = new OutputShapeFragment().text()

    expect(text).toContain('```mermaid fence')
    expect(text).toContain('renders it as a diagram')
  })
})
