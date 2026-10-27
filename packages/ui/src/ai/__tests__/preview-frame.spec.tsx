import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PreviewFrame } from '../preview-frame'
import { EPreviewStatus, selectedPortOf, type PreviewPort } from '../preview-ports'

const PORTS: PreviewPort[] = [
  {
    id: 'a',
    port: 6006,
    label: 'Storybook',
    url: 'https://a.test',
    status: EPreviewStatus.Live,
  },
  {
    id: 'b',
    port: 3000,
    label: 'Web',
    url: 'https://b.test',
    status: EPreviewStatus.Starting,
  },
  {
    id: 'c',
    port: 4000,
    label: 'API',
    url: 'https://c.test',
    status: EPreviewStatus.Stopped,
  },
]

const render = (selectedId?: string) =>
  renderToStaticMarkup(
    <PreviewFrame ports={PORTS} selectedId={selectedId} onSelect={() => undefined} />,
  )

describe('selectedPortOf', () => {
  it('falls back to the first port for an unknown or missing id', () => {
    expect(selectedPortOf({ ports: PORTS, selectedId: 'b' })?.id).toBe('b')
    expect(selectedPortOf({ ports: PORTS, selectedId: 'zzz' })?.id).toBe('a')
    expect(selectedPortOf({ ports: [] })).toBeUndefined()
  })
})

describe('PreviewFrame', () => {
  it('embeds a live port in an iframe and links it open in a new tab', () => {
    const html = render('a')
    expect(html).toContain('<iframe')
    expect(html).toContain('src="https://a.test"')
    expect(html).toContain('href="https://a.test"')
    expect(html).toContain('target="_blank"')
  })

  it('shows a notice instead of an iframe while the port is starting or stopped', () => {
    expect(render('b')).not.toContain('<iframe')
    expect(render('b')).toContain('still booting')
    expect(render('c')).not.toContain('<iframe')
    expect(render('c')).toContain('Nothing is listening on port')
  })

  it('lists every port', () => {
    const html = render('a')
    for (const port of PORTS) expect(html).toContain(`:${port.port}`)
  })

  it('renders nothing without ports', () => {
    expect(renderToStaticMarkup(<PreviewFrame ports={[]} onSelect={() => undefined} />)).toBe('')
  })
})
