import { describe, expect, it } from 'bun:test'

import { childViewIdsOf } from '../preview-views'

const HOST = 7
const OTHER_HOST = 8

describe('childViewIdsOf', () => {
  it('names only the views this window hosted, so a reload drops its panes and nobody else', () => {
    const ids = childViewIdsOf({
      hostId: HOST,
      views: [
        { id: 11, hostWebviewId: HOST },
        { id: 12, hostWebviewId: OTHER_HOST },
        { id: 13, hostWebviewId: HOST },
        { id: 14, hostWebviewId: undefined },
      ],
    })

    expect(ids).toEqual([11, 13])
  })

  it('names nothing before the window exists or when it hosts no views', () => {
    expect(childViewIdsOf({ hostId: undefined, views: [{ id: 11, hostWebviewId: HOST }] })).toEqual(
      [],
    )
    expect(
      childViewIdsOf({ hostId: HOST, views: [{ id: 12, hostWebviewId: OTHER_HOST }] }),
    ).toEqual([])
  })
})
