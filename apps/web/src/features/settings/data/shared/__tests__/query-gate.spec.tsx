import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { QueryBody, QueryPage, QuerySection } from '../../personal/query-boundary'
import { QueryGate } from '../query-gate'

const reload = () => {}
const loading: CloudQuery<string> = {
  state: EQueryState.Loading,
  data: undefined,
  error: undefined,
  reload,
}
const ready: CloudQuery<string> = {
  state: EQueryState.Ready,
  data: 'loaded value',
  error: undefined,
  reload,
}
const skeleton = <div data-testid="caller-skeleton" />

describe('QueryGate', () => {
  it('renders the caller skeleton in a labelled status region while loading', () => {
    const html = renderToStaticMarkup(
      <QueryGate query={loading} label="projects" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QueryGate>,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading projects"')
    expect(html).toContain('data-testid="caller-skeleton"')
  })

  it('renders the children once ready', () => {
    const html = renderToStaticMarkup(
      <QueryGate query={ready} label="projects" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QueryGate>,
    )
    expect(html).toContain('loaded value')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('caller-skeleton')
  })
})

describe('QueryBody', () => {
  it('shows the skeleton while loading and children when ready', () => {
    const wait = renderToStaticMarkup(
      <QueryBody query={loading} label="memory" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QueryBody>,
    )
    expect(wait).toContain('aria-label="Loading memory"')
    expect(wait).toContain('caller-skeleton')
    const done = renderToStaticMarkup(
      <QueryBody query={ready} label="memory" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QueryBody>,
    )
    expect(done).toContain('loaded value')
    expect(done).not.toContain('role="status"')
  })
})

describe('QueryPage', () => {
  it('keeps the page header and shows the caller skeleton while loading', () => {
    const html = renderToStaticMarkup(
      <QueryPage query={loading} title="Account" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QueryPage>,
    )
    expect(html).toContain('Account</h1>')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading Account"')
    expect(html).toContain('caller-skeleton')
  })

  it('renders only the children once ready', () => {
    const html = renderToStaticMarkup(
      <QueryPage query={ready} title="Account" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QueryPage>,
    )
    expect(html).toBe('<p>loaded value</p>')
  })
})

describe('QuerySection', () => {
  it('keeps the section heading and shows the caller skeleton while loading', () => {
    const html = renderToStaticMarkup(
      <QuerySection query={loading} title="MCP servers" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QuerySection>,
    )
    expect(html).toContain('MCP servers</h2>')
    expect(html).toContain('aria-label="Loading MCP servers"')
    expect(html).toContain('caller-skeleton')
  })

  it('renders only the children once ready', () => {
    const html = renderToStaticMarkup(
      <QuerySection query={ready} title="MCP servers" skeleton={skeleton}>
        {(data) => <p>{data}</p>}
      </QuerySection>,
    )
    expect(html).toBe('<p>loaded value</p>')
  })
})
