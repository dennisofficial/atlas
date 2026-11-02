import { describe, expect, it } from 'bun:test'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'

import { previewLinkRouteOf, previewPortForUrl, type LinkClickModifiers } from '../preview-ports'

const ports: PreviewPort[] = [
  {
    id: 'service:web',
    port: 3100,
    label: 'web',
    url: 'https://3100-abc.byatlas.dev',
    status: EPreviewStatus.Live,
  },
  {
    id: 'service:api',
    port: 4000,
    label: 'api',
    url: 'https://4000-abc.byatlas.dev',
    frameSrc: 'https://frame-4000.example.test/x',
    status: EPreviewStatus.Live,
  },
]

const plain: LinkClickModifiers = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
}

describe('previewPortForUrl', () => {
  it('matches the port root and deeper paths by origin', () => {
    expect(previewPortForUrl({ url: 'https://3100-abc.byatlas.dev', ports })?.id).toBe(
      'service:web',
    )
    expect(previewPortForUrl({ url: 'https://3100-abc.byatlas.dev/a/b?x=1#h', ports })?.id).toBe(
      'service:web',
    )
  })

  it('matches a frameSrc origin', () => {
    expect(previewPortForUrl({ url: 'https://frame-4000.example.test/page', ports })?.id).toBe(
      'service:api',
    )
  })

  it('rejects other origins, other ports, other schemes and garbage', () => {
    expect(previewPortForUrl({ url: 'https://3101-abc.byatlas.dev', ports })).toBeNull()
    expect(previewPortForUrl({ url: 'http://3100-abc.byatlas.dev', ports })).toBeNull()
    expect(previewPortForUrl({ url: 'https://3100-abc.byatlas.dev.evil.test', ports })).toBeNull()
    expect(previewPortForUrl({ url: 'javascript:alert(1)', ports })).toBeNull()
    expect(previewPortForUrl({ url: '#top', ports })).toBeNull()
    expect(previewPortForUrl({ url: 'https://3100-abc.byatlas.dev', ports: [] })).toBeNull()
  })
})

describe('previewLinkRouteOf', () => {
  const href = 'https://3100-abc.byatlas.dev/docs?q=1'

  it('routes a matching plain click to the port with the full url', () => {
    expect(previewLinkRouteOf({ href, ports, click: plain })).toEqual({
      portId: 'service:web',
      url: href,
    })
  })

  it('leaves non-matching links alone', () => {
    expect(previewLinkRouteOf({ href: 'https://example.com', ports, click: plain })).toBeNull()
  })

  it('leaves modifier and non-primary clicks to the browser', () => {
    for (const click of [
      { ...plain, metaKey: true },
      { ...plain, ctrlKey: true },
      { ...plain, shiftKey: true },
      { ...plain, altKey: true },
      { ...plain, button: 1 },
    ]) {
      expect(previewLinkRouteOf({ href, ports, click })).toBeNull()
    }
  })
})
