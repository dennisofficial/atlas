import { EReturnResult } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { acceptedReturnOf } from '../return-outcome'

const START = 'https://api.byatlas.io/return/start/st_1?surface=ios'

const returned = (query: string): string => `atlas://sessions/ses_1?${query}`

describe('acceptedReturnOf', () => {
  it('accepts a return that carries the state of the start link', () => {
    expect(
      acceptedReturnOf({
        startLink: START,
        returnedUrl: returned('atlasReturn=connected&atlasState=st_1'),
      }),
    ).toEqual({ state: 'st_1', outcome: { result: EReturnResult.Connected } })
  })

  it('keeps the reason of a refused return', () => {
    expect(
      acceptedReturnOf({
        startLink: START,
        returnedUrl: returned('atlasReturn=failed&atlasReason=denied&atlasState=st_1'),
      }),
    ).toEqual({
      state: 'st_1',
      outcome: { result: EReturnResult.Failed, reason: 'denied' },
    })
  })

  it('ignores a return link for another state', () => {
    expect(
      acceptedReturnOf({
        startLink: START,
        returnedUrl: returned('atlasReturn=connected&atlasState=st_2'),
      }),
    ).toBeUndefined()
  })

  it('ignores a start link whose state it cannot read', () => {
    expect(
      acceptedReturnOf({
        startLink: 'nope',
        returnedUrl: returned('atlasReturn=connected&atlasState=st_1'),
      }),
    ).toBeUndefined()
  })

  it('ignores a link that carries no outcome', () => {
    expect(
      acceptedReturnOf({ startLink: START, returnedUrl: 'atlas://sessions/ses_1' }),
    ).toBeUndefined()
  })
})
