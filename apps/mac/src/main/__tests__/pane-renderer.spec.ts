import { describe, expect, test } from 'bun:test'
import { paneRendererOf } from '../pane-renderer'

describe('paneRendererOf', () => {
  test('uses the system web view by default', () => {
    expect(paneRendererOf({ available: ['native', 'cef'], requested: undefined })).toBe('native')
    expect(paneRendererOf({ available: [], requested: undefined })).toBe('native')
  })
  test('uses Chromium only when it is asked for and bundled', () => {
    expect(paneRendererOf({ available: ['native', 'cef'], requested: 'cef' })).toBe('cef')
    expect(paneRendererOf({ available: ['native'], requested: 'cef' })).toBe('native')
    expect(paneRendererOf({ available: ['native', 'cef'], requested: 'chromium' })).toBe('native')
  })
})
