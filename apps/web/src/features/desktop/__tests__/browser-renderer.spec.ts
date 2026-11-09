import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, createElement } from 'react'

import { browserRendererOf, useBrowserRenderer } from '../use-browser-renderer'
import { desktopVersionSchema, resetDesktopVersion } from '../version-wire'

describe('browserRendererOf', () => {
  it('picks chromium when the app reports it', () => {
    expect(browserRendererOf({ version: '1.42.0', channel: 'stable', chromium: true })).toBe('cef')
  })

  it('falls back to the native engine for absent, false or unknown info', () => {
    expect(browserRendererOf({ version: '1.42.0', channel: 'stable' })).toBe('native')
    expect(browserRendererOf({ version: '1.42.0', channel: 'stable', chromium: false })).toBe(
      'native',
    )
    expect(browserRendererOf(null)).toBe('native')
  })
})

describe('desktopVersionSchema', () => {
  it('parses the payload of an app that ships Chromium', () => {
    expect(
      desktopVersionSchema.parse({ version: '1.42.0', channel: 'stable', chromium: true }),
    ).toEqual({ version: '1.42.0', channel: 'stable', chromium: true })
  })

  it('parses the payload of an app that does not report chromium', () => {
    expect(desktopVersionSchema.parse({ version: '1.42.0', channel: 'stable' })).toEqual({
      version: '1.42.0',
      channel: 'stable',
    })
  })
})

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const realFetch = globalThis.fetch
const reads: Array<string | null> = []

afterEach(() => {
  globalThis.fetch = realFetch
  resetDesktopVersion()
  reads.length = 0
  document.body.innerHTML = ''
})

function stubHost(payload: unknown) {
  globalThis.fetch = Object.assign(async () => Response.json(payload), {
    preconnect: realFetch.preconnect,
  })
}

function Probe() {
  reads.push(useBrowserRenderer())
  return null
}

async function mount() {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(Probe)))
  await act(async () => undefined)
  return () => act(async () => root.unmount())
}

describe('useBrowserRenderer', () => {
  it('reports nothing until the host answers, then chromium', async () => {
    stubHost({ version: '1.42.0', channel: 'stable', chromium: true })
    const unmount = await mount()
    expect(reads[0]).toBeNull()
    expect(reads.at(-1)).toBe('cef')
    await unmount()
  })

  it('settles on the native engine for an app without chromium', async () => {
    stubHost({ version: '1.42.0', channel: 'stable' })
    const unmount = await mount()
    expect(reads.at(-1)).toBe('native')
    await unmount()
  })
})
