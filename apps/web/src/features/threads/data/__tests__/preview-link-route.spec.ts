import { describe, expect, it } from 'bun:test'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { ELinkClickTarget, previewLinkRouteOf, type LinkClickModifiers } from '../preview-link'
import { previewPortForUrl } from '../preview-ports'

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

  it('routes a plain click on a session port to the preview', () => {
    expect(previewLinkRouteOf({ href, ports, click: plain })).toEqual({
      target: ELinkClickTarget.Preview,
      url: href,
    })
  })

  it('routes a plain click on any other web page to the preview', () => {
    expect(previewLinkRouteOf({ href: 'https://example.com/a', ports, click: plain })).toEqual({
      target: ELinkClickTarget.Preview,
      url: 'https://example.com/a',
    })
  })

  it('maps a localhost link to the session port it stands for', () => {
    expect(
      previewLinkRouteOf({ href: 'http://localhost:3100/docs?q=1', ports, click: plain }),
    ).toEqual({ target: ELinkClickTarget.Preview, url: 'https://3100-abc.byatlas.dev/docs?q=1' })
    expect(previewLinkRouteOf({ href: 'http://127.0.0.1:4000', ports, click: plain })).toEqual({
      target: ELinkClickTarget.Preview,
      url: 'https://4000-abc.byatlas.dev/',
    })
  })

  it('leaves modified clicks on a session url to the browser', () => {
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

  it('sends a modified click on a localhost link to the session url in a new tab', () => {
    expect(
      previewLinkRouteOf({
        href: 'http://localhost:3100/docs',
        ports,
        click: { ...plain, metaKey: true },
      }),
    ).toEqual({ target: ELinkClickTarget.Browser, url: 'https://3100-abc.byatlas.dev/docs' })
  })

  it('leaves modified clicks on other pages and non-web links to the browser', () => {
    expect(
      previewLinkRouteOf({
        href: 'https://example.com/a',
        ports,
        click: { ...plain, metaKey: true },
      }),
    ).toBeNull()
    expect(previewLinkRouteOf({ href: 'mailto:me@example.com', ports, click: plain })).toBeNull()
    expect(previewLinkRouteOf({ href: '#section', ports, click: plain })).toBeNull()
  })

  it('shows a port this session does not expose as it stands', () => {
    expect(previewLinkRouteOf({ href: 'http://localhost:9999/x', ports, click: plain })).toEqual({
      target: ELinkClickTarget.Preview,
      url: 'http://localhost:9999/x',
    })
  })
})
