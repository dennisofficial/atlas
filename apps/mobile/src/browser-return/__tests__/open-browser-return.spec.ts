import { EReturnResult } from '@dltech/atlas-core'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import { afterEach, describe, expect, it, mock } from 'bun:test'

type Opened = { startLink: string; returnUrl: string }

const opened: Opened[] = []
let answer: { type: string; url?: string } = { type: 'success', url: '' }

mock.module('expo-web-browser', () => ({
  openAuthSessionAsync: async (startLink: string, returnUrl: string) => {
    opened.push({ startLink, returnUrl })
    return answer
  },
  openBrowserAsync: async () => undefined,
}))

const { openBrowserReturn } = await import('../open-browser-return')

const START_URL = 'https://api.byatlas.io/return/start/st_open'
const returned = (query: string): string => `atlas://sessions/ses_1?${query}`
const connected = returned('atlasReturn=connected&atlasState=st_open')

afterEach(() => {
  opened.length = 0
  answer = { type: 'success', url: '' }
})

describe('openBrowserReturn', () => {
  it('opens the start link in an auth session that returns to the app', async () => {
    answer = { type: 'success', url: connected }
    await openBrowserReturn({ url: START_URL })

    const [session] = opened
    expect(new URL(session?.startLink ?? '').searchParams.get('surface')).toBe('ios')
    expect(session?.returnUrl).toBe('atlas://')
  })

  it('returns the outcome of a return that matches the state it waited on', async () => {
    answer = { type: 'success', url: connected }

    expect(await openBrowserReturn({ url: START_URL })).toEqual({
      result: EReturnResult.Connected,
    })
    expect(browserReturns.read('st_open')).toEqual({ result: EReturnResult.Connected })
  })

  it('ignores a return for another state', async () => {
    answer = { type: 'success', url: returned('atlasReturn=connected&atlasState=st_other') }

    expect(await openBrowserReturn({ url: START_URL })).toBeUndefined()
    expect(browserReturns.read('st_other')).toBeUndefined()
  })

  it('returns nothing when the sheet is dismissed', async () => {
    answer = { type: 'cancel' }

    expect(await openBrowserReturn({ url: START_URL })).toBeUndefined()
  })
})
