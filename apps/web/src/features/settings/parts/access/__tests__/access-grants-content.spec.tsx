import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AccessGrant } from '@dltech/atlas-wire/web'

import { AccessGrantsContent } from '../access-grants-content'

const GRANT: AccessGrant = {
  id: 'g1',
  name: 'PlanetScale',
  instruction: 'These two variables give the pscale CLI full access to the app database.',
  secretNames: ['PSCALE_TOKEN'],
  filePaths: ['/root/.config/gh/hosts.yml'],
  updatedAt: '2026-11-25T00:00:00.000Z',
}

const render = (grants: AccessGrant[]): string =>
  renderToStaticMarkup(
    <AccessGrantsContent
      grants={grants}
      secretNames={['PSCALE_TOKEN']}
      filePaths={['/root/.config/gh/hosts.yml']}
      onSave={async () => undefined}
      onRemove={async () => undefined}
    />,
  )

describe('AccessGrantsContent', () => {
  it('teaches the feature and offers the first grant when there are none', () => {
    const html = render([])
    expect(html).toContain('No access grants yet')
    expect(html).toContain('Group a secret or a mounted file')
    expect(html).toContain('New grant')
  })

  it('shows each grant with its instruction, members and row actions', () => {
    const html = render([GRANT])
    expect(html).toContain('PlanetScale')
    expect(html).toContain('These two variables give the pscale CLI')
    expect(html).toContain('PSCALE_TOKEN')
    expect(html).toContain('/root/.config/gh/hosts.yml')
    expect(html).toContain('PlanetScale actions')
  })
})
