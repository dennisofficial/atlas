import { describe, expect, it } from 'bun:test'

import { OutputShapeFragment } from '../fragments/output'

describe('the output shape fragment', () => {
  it('tells the model the client renders mermaid fences as diagrams', () => {
    const text = new OutputShapeFragment().text()

    expect(text).toContain('```mermaid fence')
    expect(text).toContain('renders it as a diagram')
  })

  it('names the mermaid syntax that most often breaks a diagram', () => {
    const text = new OutputShapeFragment().text()

    expect(text).toContain('double quotes')
    expect(text).toContain('sequence-message text')
  })
})
