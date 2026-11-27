import { EReturnResult } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { returnActionOf, returnWindowNameOf } from '../return-action'

const hrefOf = (query: string): string => `https://byatlas.io/sessions/ses_1?${query}`

describe('returnActionOf', () => {
  it('ignores a page url that carries no return', () => {
    expect(
      returnActionOf({ href: 'https://byatlas.io/sessions/ses_1?tab=files', windowName: '' }),
    ).toBeUndefined()
  })

  it('ignores a result that arrives without its state', () => {
    expect(
      returnActionOf({ href: hrefOf('atlasReturn=connected'), windowName: '' }),
    ).toBeUndefined()
  })

  it('reads a connected return and strips the return params from the url', () => {
    const action = returnActionOf({
      href: hrefOf('tab=files&atlasReturn=connected&atlasState=st_1'),
      windowName: '',
    })

    expect(action?.returned).toEqual({
      state: 'st_1',
      outcome: { result: EReturnResult.Connected },
    })
    expect(action?.cleanHref).toBe('https://byatlas.io/sessions/ses_1?tab=files')
  })

  it('keeps the reason of a refused return', () => {
    const action = returnActionOf({
      href: hrefOf('atlasReturn=failed&atlasReason=the%20provider%20refused&atlasState=st_1'),
      windowName: '',
    })

    expect(action?.returned).toEqual({
      state: 'st_1',
      outcome: { result: EReturnResult.Failed, reason: 'the provider refused' },
    })
  })

  it('closes only the window the opener named for this state', () => {
    const href = hrefOf('atlasReturn=connected&atlasState=st_1')

    expect(returnActionOf({ href, windowName: returnWindowNameOf('st_1') })?.close).toBe(true)
    expect(returnActionOf({ href, windowName: 'atlas' })?.close).toBe(false)
    expect(returnActionOf({ href, windowName: '' })?.close).toBe(false)
  })
})

describe('returnWindowNameOf', () => {
  it('names the window after the state it waits on', () => {
    expect(returnWindowNameOf('st_1')).toBe('atlas-return-st_1')
  })

  it('still names a window when the url carries no state', () => {
    expect(returnWindowNameOf(undefined)).toBe('atlas-return-')
  })
})
