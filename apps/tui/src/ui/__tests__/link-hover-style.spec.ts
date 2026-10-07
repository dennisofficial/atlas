import { describe, expect, it } from 'bun:test'

import { linkHoverStyle } from '../link-hover-style'
import { theme } from '../theme'

describe('link hover inversion', () => {
  it('uses the normal link color as the background with dark ink for light colors', () => {
    expect(linkHoverStyle(theme.link)).toEqual({ bg: theme.link, fg: '#000000' })
    expect(linkHoverStyle(theme.accent)).toEqual({ bg: theme.accent, fg: '#000000' })
    expect(linkHoverStyle('#ffffff')).toEqual({ bg: '#ffffff', fg: '#000000' })
  })

  it('uses white ink for dark colors', () => {
    expect(linkHoverStyle('#000000')).toEqual({ bg: '#000000', fg: '#ffffff' })
    expect(linkHoverStyle('#003366')).toEqual({ bg: '#003366', fg: '#ffffff' })
    expect(linkHoverStyle('#ff0000')).toEqual({ bg: '#ff0000', fg: '#000000' })
  })

  it('chooses by linear sRGB contrast rather than uncorrected brightness', () => {
    expect(linkHoverStyle('#777777')).toEqual({ bg: '#777777', fg: '#000000' })
    expect(linkHoverStyle('#747474')).toEqual({ bg: '#747474', fg: '#ffffff' })
  })
})
