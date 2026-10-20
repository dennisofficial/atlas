import { describe, expect, it } from 'bun:test'

import { pushRequestOf } from '../push'

const requestFor = (line: string) => pushRequestOf({ argv: line.split(' ') })

describe('what the operator typed after atlas', () => {
  it('ignores anything that is not push', () => {
    expect(requestFor('classify --yes')).toBeUndefined()
    expect(pushRequestOf({ argv: [] })).toBeUndefined()
  })

  it('reads a bare push as an interactive push', () => {
    expect(requestFor('push')).toEqual({ yes: false, help: false, unknown: [] })
  })

  it('reads --yes and -y', () => {
    expect(requestFor('push --yes')?.yes).toBe(true)
    expect(requestFor('push -y')?.yes).toBe(true)
  })

  it('reads --help and -h', () => {
    expect(requestFor('push --help')?.help).toBe(true)
    expect(requestFor('push -h')?.help).toBe(true)
  })

  it('reports flags it does not know', () => {
    expect(requestFor('push --force --yes')).toEqual({ yes: true, help: false, unknown: ['--force'] })
  })
})
