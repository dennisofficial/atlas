import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { rmSync } from 'node:fs'

import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { capturePortableState, materializePortableState } from '../portable-state'
import { OAUTH_TOKENS, openHome, type PortableHome } from './portable-state-fixture'

const AUTHORITY = { url: 'https://api.atlas.test', connectionId: 'conn_1', generation: 4 }
const OPERATOR_SESSION_TOKEN = 'operator-session-token'

describe('portable state OAuth authority', () => {
  let source: PortableHome
  let target: PortableHome

  beforeEach(() => {
    source = openHome()
    target = openHome()
  })

  afterEach(() => {
    rmSync(source.directory, { recursive: true, force: true })
    rmSync(target.directory, { recursive: true, force: true })
  })

  const seedAuthorityOauth = async () =>
    source.store.add({
      provider: EAuthProvider.Anthropic,
      label: 'Claude subscription',
      secret: { kind: EAuthKind.Oauth, tokens: OAUTH_TOKENS, authority: AUTHORITY },
      origin: EAccountOrigin.Login,
    })

  it('carries the authority marker through capture and install with the refresh token blank', async () => {
    const seeded = await seedAuthorityOauth()

    const state = await capturePortableState({ home: source.directory })
    await materializePortableState({ state, home: target.directory })

    const installed = await target.store.read(seeded.id)
    expect(installed?.secret).toEqual({
      kind: EAuthKind.Oauth,
      tokens: { ...OAUTH_TOKENS, refreshToken: '' },
      authority: AUTHORITY,
    })
  })

  it('keeps the source vault untouched: its refresh token and authority stay local', async () => {
    const seeded = await seedAuthorityOauth()

    await capturePortableState({ home: source.directory })

    const held = await source.store.read(seeded.id)
    expect(held?.secret).toEqual({ kind: EAuthKind.Oauth, tokens: OAUTH_TOKENS, authority: AUTHORITY })
  })

  it('never serialises a refresh token or an operator session credential into the snapshot', async () => {
    await seedAuthorityOauth()

    const state = await capturePortableState({ home: source.directory })

    const serialised = JSON.stringify(state)
    expect(serialised).not.toContain(OAUTH_TOKENS.refreshToken)
    expect(serialised).not.toContain(OPERATOR_SESSION_TOKEN)
    expect(state.secrets.map((secret) => secret.name)).not.toContain('cloud-session')
  })
})
