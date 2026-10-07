import { expect, it } from 'bun:test'
import { parseBakedRuntime } from '../runtime'

it('preserves an unversioned development image while identifying its protocol and bake', () => {
  expect(parseBakedRuntime('version=\nprotocol=19\nbakeId=1791389874-1\n')).toEqual({
    version: null,
    protocol: '19',
    bakeId: '1791389874-1',
  })
})
