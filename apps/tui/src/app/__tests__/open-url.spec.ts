import { describe, expect, it } from 'bun:test'

import { browserLaunchOf } from '../open-url'

const URL = 'https://byatlas.io/device?user_code=ABCD'

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
