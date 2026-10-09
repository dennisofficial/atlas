import { expect, it } from 'bun:test'
import { parseBakedRuntime } from '../runtime'

it('preserves an unversioned development runtime while identifying its protocol', () => {
  expect(parseBakedRuntime('version=\nprotocol=19\n')).toEqual({
    version: null,
    protocol: '19',
  })
})

it('identifies a versioned runtime', () => {
  expect(parseBakedRuntime('version=1.91.2\nprotocol=22\n')).toEqual({
    version: '1.91.2',
    protocol: '22',
  })
})
