import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { DESKTOP_NAVIGATE_EVENT } from '@dltech/atlas-wire/web'

import { desktopPathOf } from '../use-desktop-navigation'

beforeAll(() => GlobalRegistrator.register())
afterAll(async () => GlobalRegistrator.unregister())

const navigate = (detail: unknown) => new CustomEvent(DESKTOP_NAVIGATE_EVENT, { detail })

describe('desktopPathOf', () => {
  it('reads an in-app path', () => {
    expect(desktopPathOf(navigate('/settings'))).toBe('/settings')
  })

  it('ignores anything else', () => {
    expect(desktopPathOf(navigate('//evil.example'))).toBeNull()
    expect(desktopPathOf(navigate('https://evil.example'))).toBeNull()
    expect(desktopPathOf(navigate(5))).toBeNull()
    expect(desktopPathOf(new Event(DESKTOP_NAVIGATE_EVENT))).toBeNull()
  })
})
