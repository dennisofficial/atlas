import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { RETURN_WINDOW_FEATURES, openBrowserReturn } from '../open-browser-return'

const START_URL = 'https://api.byatlas.io/return/start/st_1'
const DESKTOP_HOST = { atlasDesktop: { vibrancy: true } }
const WEB_HOST = {}

type Opened = { href: string; windowName: string; features: string }

let opened: Opened[] = []

beforeAll(() => {
  registerDom()
  window.open = ((href: string, windowName: string, features: string) => {
    opened.push({ href, windowName, features })
    return null
  }) as typeof window.open
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  opened = []
})

describe('openBrowserReturn', () => {
  it('opens the web start link in a window named after the state', () => {
    openBrowserReturn({ url: START_URL, host: WEB_HOST })

    expect(opened).toEqual([
      {
        href: `${START_URL}?surface=web`,
        windowName: 'atlas-return-st_1',
        features: RETURN_WINDOW_FEATURES,
      },
    ])
  })

  it('asks for the desktop surface on the Mac host', () => {
    openBrowserReturn({ url: START_URL, host: DESKTOP_HOST })

    expect(opened[0]?.href).toBe(`${START_URL}?surface=desktop`)
  })

  it('opens the window without access to this page', () => {
    openBrowserReturn({ url: START_URL, host: WEB_HOST })

    expect(opened[0]?.features).toBe('noopener,noreferrer')
  })
})
