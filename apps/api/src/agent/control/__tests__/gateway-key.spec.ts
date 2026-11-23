import { describe, expect, it } from 'bun:test'

import { EAuthProvider, toAccountId } from '@dltech/atlas-core'
import type { ActiveAccountRowLike, SealedAccountRowLike } from '@dltech/atlas-credentials'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import { gatewayKeyOf, type GatewayAccountRows } from '../gateway-key'

const KEY = 'b'.repeat(64)

const cipher = new SecretCipher(KEY)

const USER = 'usr-1'

const sealed = (secret: unknown): string => cipher.encrypt(JSON.stringify(secret))

const accountRow = (args: {
  id: string
  provider?: string
  kind?: string
  secret: unknown
}): SealedAccountRowLike => ({
  id: args.id,
  provider: args.provider ?? EAuthProvider.Gateway,
  kind: args.kind ?? 'api-key',
  origin: 'login',
  label: 'Vercel AI Gateway',
  status: 'active',
  email: null,
  subscription: null,
  importedFrom: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  sealedSecret: sealed(args.secret),
})

const rowsOf = (args: {
  accounts?: readonly SealedAccountRowLike[]
  active?: readonly ActiveAccountRowLike[]
}): GatewayAccountRows => ({
  accounts: async () => args.accounts ?? [],
  active: async () => args.active ?? [],
})

describe('gatewayKeyOf', () => {
  it('answers the api key of the gateway account', async () => {
    const key = await gatewayKeyOf({
      rows: rowsOf({
        accounts: [accountRow({ id: 'acc-1', secret: { kind: 'api-key', apiKey: 'vck_1' } })],
      }),
      cipher,
      userId: USER,
    })

    expect(key).toBe('vck_1')
  })

  it('answers no key when the operator holds no gateway account', async () => {
    const key = await gatewayKeyOf({ rows: rowsOf({}), cipher, userId: USER })

    expect(key).toBeUndefined()
  })

  it('prefers the account the active pointer names', async () => {
    const key = await gatewayKeyOf({
      rows: rowsOf({
        accounts: [
          accountRow({ id: 'acc-1', secret: { kind: 'api-key', apiKey: 'vck_old' } }),
          accountRow({ id: 'acc-2', secret: { kind: 'api-key', apiKey: 'vck_new' } }),
        ],
        active: [{ provider: EAuthProvider.Gateway, accountId: toAccountId('acc-2') }],
      }),
      cipher,
      userId: USER,
    })

    expect(key).toBe('vck_new')
  })

  it('answers no key for a gateway account whose secret is not an api key', async () => {
    const key = await gatewayKeyOf({
      rows: rowsOf({
        accounts: [accountRow({ id: 'acc-1', secret: { kind: 'oauth', tokens: {} } })],
      }),
      cipher,
      userId: USER,
    })

    expect(key).toBeUndefined()
  })

  it('answers no key rather than failing on a secret it cannot open', async () => {
    const key = await gatewayKeyOf({
      rows: rowsOf({
        accounts: [{ ...accountRow({ id: 'acc-1', secret: {} }), sealedSecret: 'not-sealed' }],
      }),
      cipher,
      userId: USER,
    })

    expect(key).toBeUndefined()
  })
})
