import { describe, expect, test } from 'bun:test'

import { routeParamOf } from '../route-param'

describe('routeParamOf', () => {
  test('reads the segment Next matched for the route', () => {
    expect(routeParamOf({ threadId: 'abc123' }, 'threadId')).toBe('abc123')
  })

  test('decodes an encoded id', () => {
    expect(routeParamOf({ skillId: 'my%20skill' }, 'skillId')).toBe('my skill')
  })

  test('keeps a value that is not valid percent-encoding', () => {
    expect(routeParamOf({ skillId: '100%' }, 'skillId')).toBe('100%')
  })

  test('refuses a repeated segment instead of guessing', () => {
    expect(() => routeParamOf({ sessionId: ['a', 'b'] }, 'sessionId')).toThrow('sessionId')
  })

  test('refuses a missing segment', () => {
    expect(() => routeParamOf({}, 'projectId')).toThrow('projectId')
  })
})
