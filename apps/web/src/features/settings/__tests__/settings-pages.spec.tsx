import { describe, expect, it } from 'bun:test'
import { isValidElement } from 'react'

import { ESettingsPage } from '../settings-nav'
import { renderSettingsPage } from '../settings-pages'

describe('settings pages', () => {
  it('renders a component for every page', () => {
    for (const page of Object.values(ESettingsPage)) {
      const element = renderSettingsPage(page)
      expect(isValidElement(element)).toBe(true)
    }
  })
})
