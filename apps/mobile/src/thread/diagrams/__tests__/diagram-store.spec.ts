import { describe, expect, test } from 'bun:test'

import { diagramSourceOf, DIAGRAM_STORE_LIMIT, putDiagramSource } from '../diagram-store'

describe('diagram source store', () => {
  test('returns the source it stored, trimmed', () => {
    const id = putDiagramSource({ source: '\n  graph TD\nA-->B\n' })
    expect(diagramSourceOf(id)).toBe('graph TD\nA-->B')
  })

  test('an unknown or missing id has no source', () => {
    expect(diagramSourceOf('diagram-missing')).toBeUndefined()
    expect(diagramSourceOf(undefined)).toBeUndefined()
  })

  test('keeps the newest entries and drops the oldest', () => {
    const oldest = putDiagramSource({ source: 'graph TD\noldest-->gone' })
    let newest = ''
    for (let index = 0; index < DIAGRAM_STORE_LIMIT * 2; index++) {
      newest = putDiagramSource({ source: `graph TD\nnode${index}-->next` })
    }
    expect(diagramSourceOf(oldest)).toBeUndefined()
    expect(diagramSourceOf(newest)).toBe(`graph TD\nnode${DIAGRAM_STORE_LIMIT * 2 - 1}-->next`)
  })
})
