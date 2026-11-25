import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AccessGrant } from '@dltech/atlas-wire/web'

import { AccessGrantsContent } from '../access-grants-content'
import type { AccessGrantsActions } from '../use-access-grants'

const GRANT: AccessGrant = {
  id: 'g1',
  name: 'PlanetScale',
  instruction: 'These two variables give the pscale CLI full access to the app database.',
  secrets: [{ name: 'PSCALE_TOKEN', updatedAt: '2026-11-25T00:00:00.000Z' }],
  files: [{ path: '~/.config/gh/hosts.yml', mode: 384, updatedAt: '2026-11-25T00:00:00.000Z' }],
  updatedAt: '2026-11-25T00:00:00.000Z',
}

const noop = async (): Promise<void> => undefined

const ACTIONS: AccessGrantsActions = {
  save: noop,
  remove: noop,
  moveMember: noop,
  setSecret: noop,
  removeSecret: noop,
  revealSecret: async () => '',
  setFile: noop,
  removeFile: noop,
  revealFile: async () => '',
}

const render = (grants: AccessGrant[]): string =>
  renderToStaticMarkup(
    <AccessGrantsContent
      grants={grants}
      now={Date.parse('2026-11-25T00:00:00.000Z')}
      personal={false}
      entries={[]}
      secretDescription="Available to every thread in this project as an environment variable."
      actions={ACTIONS}
    />,
  )

describe('AccessGrantsContent', () => {
  it('teaches the feature and offers the first grant when there are none', () => {
    const html = render([])
    expect(html).toContain('No access grants yet')
    expect(html).toContain('A grant groups the secrets and files one job needs')
    expect(html).toContain('Create a grant, then add its secrets')
    expect(html).toContain('New grant')
    expect(html).not.toContain('Add secret')
    expect(html).not.toContain('Add file')
    expect(html).not.toContain('Bulk add')
  })

  it('offers only the grant actions at page level', () => {
    const html = render([GRANT])
    expect(html).toContain('New grant')
    expect(html).not.toContain('A quick add makes a grant of one')
  })

  it('shows each grant with its instruction, its members and its row actions', () => {
    const html = render([GRANT])
    expect(html).toContain('PlanetScale')
    expect(html).toContain('These two variables give the pscale CLI')
    expect(html).toContain('PSCALE_TOKEN')
    expect(html).toContain('~/.config/gh/hosts.yml')
    expect(html).toContain('PlanetScale actions')
    expect(html).toContain('Add secret')
    expect(html).toContain('Add file')
    expect(html).toContain('Bulk add')
  })

  it('marks an empty member section instead of hiding it', () => {
    const html = render([{ ...GRANT, secrets: [], files: [] }])
    expect(html).toContain('No secrets in this grant yet.')
    expect(html).toContain('No files in this grant yet.')
  })
})
