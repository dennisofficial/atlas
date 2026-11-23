import { EAuthKind, EAuthProvider } from '@dltech/atlas-core'
import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'

import { CredentialError, ECredentialFailure } from '../../model/credential-error'
import { USAGE_FLOOR_MS } from '../usage-service'
import {
  ACCOUNT,
  anthropicBody,
  harnessOf,
  json,
  NOW,
  OTHER,
  oauthSecret,
  rowOf,
  TOKEN,
  USER,
} from './usage-service.fixture'

describe('UsageService.report', () => {
  it('reads once inside the floor and again after it', async () => {
    let nowMs = NOW
    const { service, calls } = harnessOf({ now: () => nowMs })

    const first = await service.report({ userId: USER, accountId: ACCOUNT })
    const second = await service.report({ userId: USER, accountId: ACCOUNT })

    expect(calls).toHaveLength(1)
    expect(second.fetchedAt).toBe(first.fetchedAt)
    expect(first.fiveHour).toEqual({ utilization: 42, resetsAt: '2026-11-23T15:00:00.000Z' })
    expect(first.sevenDay).toBeNull()
    expect(first.metered).toBe(true)

    nowMs += USAGE_FLOOR_MS
    await service.report({ userId: USER, accountId: ACCOUNT })

    expect(calls).toHaveLength(2)
  })

  it('shares one request between concurrent readers', async () => {
    const { service, calls } = harnessOf({})

    const [first, second] = await Promise.all([
      service.report({ userId: USER, accountId: ACCOUNT }),
      service.report({ userId: USER, accountId: ACCOUNT }),
    ])

    expect(calls).toHaveLength(1)
    expect(first).toEqual(second)
  })

  it('answers unmetered for an api-key account without a request', async () => {
    const row = rowOf({
      kind: EAuthKind.ApiKey,
      sealedSecret: JSON.stringify({ kind: EAuthKind.ApiKey, apiKey: 'sk-ant-key' }),
    })
    const { service, calls } = harnessOf({ rows: [row] })

    const report = await service.report({ userId: USER, accountId: ACCOUNT })

    expect(report).toEqual({
      accountId: ACCOUNT,
      label: 'dennis@byatlas.io',
      metered: false,
      fiveHour: null,
      sevenDay: null,
      fetchedAt: null,
    })
    expect(calls).toHaveLength(0)
  })

  it('keeps the previous reading when the read fails', async () => {
    let nowMs = NOW
    let status = 200
    const { service } = harnessOf({
      now: () => nowMs,
      answer: () => json(anthropicBody, status),
    })

    const before = await service.report({ userId: USER, accountId: ACCOUNT })
    status = 401
    nowMs += USAGE_FLOOR_MS
    const after = await service.report({ userId: USER, accountId: ACCOUNT })

    expect(after.fiveHour).toEqual(before.fiveHour)
    expect(after.fetchedAt).toBe(before.fetchedAt)
  })

  it('answers two empty windows, never zero, when nothing was ever read', async () => {
    const { service } = harnessOf({ answer: () => json({}, 500) })

    const report = await service.report({ userId: USER, accountId: ACCOUNT })

    expect(report).toEqual({
      accountId: ACCOUNT,
      label: 'dennis@byatlas.io',
      metered: true,
      fiveHour: null,
      sevenDay: null,
      fetchedAt: null,
    })
  })

  it('refuses the account of another user', async () => {
    const { service } = harnessOf({})

    await expect(service.report({ userId: OTHER, accountId: ACCOUNT })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('answers by provider with the account the provider resolves to', async () => {
    const { service, calls } = harnessOf({})

    const report = await service.report({ userId: USER, provider: EAuthProvider.Anthropic })

    expect(report.accountId).toBe(ACCOUNT)
    expect(report.metered).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('answers unmetered by provider when the user has no such account', async () => {
    const { service, calls } = harnessOf({})

    const report = await service.report({ userId: USER, provider: EAuthProvider.OpenAI })

    expect(report).toEqual({
      accountId: null,
      label: null,
      metered: false,
      fiveHour: null,
      sevenDay: null,
      fetchedAt: null,
    })
    expect(calls).toHaveLength(0)
  })

  it('sends the plan token as a bearer and never returns it', async () => {
    const { service, calls } = harnessOf({})

    const report = await service.report({ userId: USER, accountId: ACCOUNT })

    expect(calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.stringify(report)).not.toContain(TOKEN)
  })

  it('sends the ChatGPT account id for a Codex account', async () => {
    const row = rowOf({
      provider: EAuthProvider.OpenAI,
      sealedSecret: oauthSecret(EAuthProvider.OpenAI),
    })
    const { service, calls } = harnessOf({
      rows: [row],
      answer: () =>
        json({ rate_limit: { primary_window: { used_percent: 12, reset_at: 1_800_000_000 } } }),
    })

    const report = await service.report({ userId: USER, accountId: ACCOUNT })

    expect(calls[0]?.headers['ChatGPT-Account-ID']).toBe('provider-account-1')
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(report.fiveHour).toEqual({
      utilization: 12,
      resetsAt: new Date(1_800_000_000_000).toISOString(),
    })
  })
})

describe('UsageService.refresh', () => {
  it('refuses the account of another user without throwing', async () => {
    const { service, calls } = harnessOf({})

    await service.refresh({ userId: OTHER, accountId: ACCOUNT })

    expect(calls).toHaveLength(0)
  })

  it('reads the account of the session owner after a turn', async () => {
    const { service, calls } = harnessOf({
      owners: { session: { userId: USER, provider: EAuthProvider.Anthropic } },
    })

    await service.refreshAfterTurn({ sessionId: 'session' })

    expect(calls).toHaveLength(1)
  })

  it('never lets a refused grant escape after a turn', async () => {
    const { service } = harnessOf({
      owners: { session: { userId: USER, provider: EAuthProvider.Anthropic } },
      issue: () =>
        Promise.reject(new CredentialError({ failure: ECredentialFailure.Expired, message: 'no' })),
    })

    await expect(service.refreshAfterTurn({ sessionId: 'session' })).resolves.toBeUndefined()
  })

  it('does nothing when the session is unknown', async () => {
    const { service, calls } = harnessOf({})

    await service.refreshAfterTurn({ sessionId: 'missing' })

    expect(calls).toHaveLength(0)
  })
})
