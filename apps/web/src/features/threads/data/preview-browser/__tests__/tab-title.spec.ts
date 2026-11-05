import { describe, expect, it } from 'bun:test'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { NEW_TAB_URL } from '../browser-model'
import { titleOf } from '../tab-title'

const PORTS: PreviewPort[] = [
  {
    id: 'service:web',
    port: 3000,
    label: 'Web',
    url: 'https://3000-abcdefghij.byatlas.dev/',
    status: EPreviewStatus.Live,
  },
]

describe('titleOf', () => {
  it('titles the new tab page', () => {
    expect(titleOf({ url: NEW_TAB_URL, ports: PORTS })).toBe('New tab')
  })

  it('uses the port label for a preview origin root', () => {
    expect(titleOf({ url: 'https://3000-abcdefghij.byatlas.dev/', ports: PORTS })).toBe('Web')
    expect(titleOf({ url: 'https://3000-abcdefghij.byatlas.dev', ports: PORTS })).toBe('Web')
  })

  it('appends the pathname below the root', () => {
    expect(titleOf({ url: 'https://3000-abcdefghij.byatlas.dev/pricing?x=1', ports: PORTS })).toBe(
      'Web/pricing',
    )
  })

  it('uses the host for external urls', () => {
    expect(titleOf({ url: 'https://example.com/a', ports: PORTS })).toBe('example.com')
  })

  it('falls back to the host for a preview host with no known port', () => {
    expect(titleOf({ url: 'https://3000-abcdefghij.byatlas.dev/', ports: [] })).toBe(
      '3000-abcdefghij.byatlas.dev',
    )
  })

  it('returns unparseable input unchanged', () => {
    expect(titleOf({ url: 'not a url', ports: PORTS })).toBe('not a url')
  })
})
