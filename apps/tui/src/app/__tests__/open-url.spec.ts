import { describe, expect, it } from 'bun:test'

import { browserLaunchOf, createUrlOpener, type UrlLauncher } from '../open-url'

const URL = 'https://byatlas.io/device?user_code=ABCD'

const launcherReporting = (args: {
  event: 'error' | 'exit'
  code?: number | null
}): UrlLauncher => {
  return () => ({
    on: (event, listener) => {
      if (event === args.event) listener(args.code ?? null)
    },
    unref: () => undefined,
  })
}

describe('browserLaunchOf', () => {
  it('opens with open on macOS', () => {
    expect(browserLaunchOf({ platform: 'darwin', url: URL })).toEqual({
      command: 'open',
      args: [URL],
    })
  })

  it('opens with start on Windows', () => {
    expect(browserLaunchOf({ platform: 'win32', url: URL })).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', URL],
    })
  })

  it('opens with xdg-open elsewhere', () => {
    expect(browserLaunchOf({ platform: 'linux', url: URL })).toEqual({
      command: 'xdg-open',
      args: [URL],
    })
  })
})

describe('createUrlOpener', () => {
  it('answers true when the browser process exits cleanly', async () => {
    const open = createUrlOpener({
      platform: 'darwin',
      launch: launcherReporting({ event: 'exit', code: 0 }),
    })

    expect(await open(URL)).toBe(true)
  })

  it('answers false when the browser process cannot start', async () => {
    const open = createUrlOpener({
      platform: 'darwin',
      launch: launcherReporting({ event: 'error' }),
    })

    expect(await open(URL)).toBe(false)
  })

  it('answers false when the browser process fails', async () => {
    const open = createUrlOpener({
      platform: 'darwin',
      launch: launcherReporting({ event: 'exit', code: 3 }),
    })

    expect(await open(URL)).toBe(false)
  })
})
