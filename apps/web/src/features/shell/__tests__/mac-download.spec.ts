import { describe, expect, it } from 'bun:test'

import { isMacBrowser, MAC_DOWNLOAD_URL, macDownloadHref } from '../mac-download'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

describe('isMacBrowser', () => {
  it('reads a Mac from the user agent when the browser reports no platform', () => {
    expect(isMacBrowser({ userAgent: SAFARI_MAC, platform: undefined, maxTouchPoints: 0 })).toBe(
      true,
    )
  })

  it('trusts the reported macOS platform', () => {
    expect(isMacBrowser({ userAgent: '', platform: 'macOS', maxTouchPoints: 0 })).toBe(true)
  })

  it('excludes an iPad, which reports a Macintosh user agent', () => {
    expect(isMacBrowser({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5, platform: undefined })).toBe(
      false,
    )
  })

  it('excludes other platforms', () => {
    expect(isMacBrowser({ userAgent: WINDOWS, platform: 'Windows', maxTouchPoints: 0 })).toBe(false)
    expect(isMacBrowser({ userAgent: IPHONE, platform: 'iOS', maxTouchPoints: 5 })).toBe(false)
  })
})

describe('macDownloadHref', () => {
  it('offers the download on a Mac browser', () => {
    expect(macDownloadHref({ navigator: { userAgent: CHROME_MAC } })).toBe(MAC_DOWNLOAD_URL)
  })

  it('reads userAgentData when the browser provides it', () => {
    expect(
      macDownloadHref({ navigator: { userAgent: '', userAgentData: { platform: 'macOS' } } }),
    ).toBe(MAC_DOWNLOAD_URL)
  })

  it('offers nothing inside the Mac app', () => {
    expect(macDownloadHref({ atlasDesktop: {}, navigator: { userAgent: CHROME_MAC } })).toBe(null)
  })

  it('offers nothing on another platform', () => {
    expect(macDownloadHref({ navigator: { userAgent: WINDOWS } })).toBe(null)
  })

  it('offers nothing without a browser navigator', () => {
    expect(macDownloadHref({})).toBe(null)
  })
})
