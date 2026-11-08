import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { pluginViewOf } from '../plugin-views'

const labels = z.array(z.string())

describe('pluginViewOf', () => {
  it('parses the named view out of the bag', () => {
    const views = { 'probe-labels': ['a', 'b'] }
    expect(pluginViewOf({ views, name: 'probe-labels', schema: labels })).toEqual(['a', 'b'])
  })

  it('returns undefined when the view is absent', () => {
    expect(pluginViewOf({ views: {}, name: 'probe-labels', schema: labels })).toBeUndefined()
    expect(pluginViewOf({ views: {}, name: 'toString', schema: labels })).toBeUndefined()
  })

  it('throws on a bag that does not match the schema', () => {
    const views = { 'probe-labels': [1] }
    expect(() => pluginViewOf({ views, name: 'probe-labels', schema: labels })).toThrow()
  })
})
