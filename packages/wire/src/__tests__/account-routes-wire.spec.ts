import { describe, expect, it } from 'bun:test'

import {
  accountDtoSchema,
  createAccountInputSchema,
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  replaceSecretInputSchema,
  storedAccountDtoSchema,
} from '../account-routes-wire'

const dto = {
  id: 'acc_1',
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: 'work',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const secret = { kind: EAuthKind.ApiKey, apiKey: 'sk-test' }

describe('account wire revision fields', () => {
  it('accepts secretVersion on the account DTO and parses without it', () => {
    expect(accountDtoSchema.parse({ ...dto, secretVersion: 3 }).secretVersion).toBe(3)
    expect(accountDtoSchema.parse(dto).secretVersion).toBeUndefined()
  })

  it('carries secretVersion through the stored account DTO', () => {
    const stored = storedAccountDtoSchema.parse({
      ...dto,
      secret,
      secretVersion: 2,
    })

    expect(stored.secretVersion).toBe(2)
  })

  it('rejects a non-integer secretVersion', () => {
    expect(accountDtoSchema.safeParse({ ...dto, secretVersion: 1.5 }).success).toBe(false)
  })

  it('refuses caller-sent revisions on every input schema', () => {
    const create = {
      provider: EAuthProvider.Anthropic,
      label: 'work',
      origin: EAccountOrigin.Login,
      secret,
    }

    for (const field of ['authorizationRevision', 'secretVersion']) {
      expect(createAccountInputSchema.safeParse({ ...create, [field]: 4 }).success).toBe(false)
      expect(
        replaceSecretInputSchema.safeParse({
          accountId: 'acc_1',
          secret,
          [field]: 4,
        }).success,
      ).toBe(false)
    }
    expect(createAccountInputSchema.safeParse(create).success).toBe(true)
  })
})
