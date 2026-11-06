import { describe, expect, it } from 'bun:test'

import { previewCallbackStartOf } from '../web/preview-callback-wire'

const CALLBACK = encodeURIComponent('https://callback.byatlas.dev/api/auth/callback/google')
const GOOGLE = `https://accounts.google.com/o/oauth2/v2/auth?client_id=c&redirect_uri=${CALLBACK}&state=s`

describe('previewCallbackStartOf', () => {
  it('routes a sign-in that returns to the callback host through its start path', () => {
    const start = new URL(previewCallbackStartOf(GOOGLE) ?? '')
    expect(`${start.origin}${start.pathname}`).toBe('https://callback.byatlas.dev/__atlas/start')
    expect(start.searchParams.get('to')).toBe(GOOGLE)
  })

  it.each([
    ['https://github.com/o/r'],
    ['https://accounts.google.com/auth?redirect_uri=https%3A%2F%2Fapp.example%2Fcb'],
    [
      'https://accounts.google.com/auth?redirect_uri=https%3A%2F%2Fcallback.byatlas.dev.evil.com%2Fcb',
    ],
    [`http://accounts.google.com/auth?redirect_uri=${CALLBACK}`],
    ['not a url'],
  ])('leaves other links alone %p', (url) => {
    expect(previewCallbackStartOf(url)).toBeNull()
  })
})
