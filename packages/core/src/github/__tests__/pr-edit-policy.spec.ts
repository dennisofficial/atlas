import { describe, expect, it } from 'bun:test'

import {
  authorListOf,
  DEFAULT_PR_EDIT_POLICY,
  EEditDisposition,
  editDispositionOf,
} from '../pr-edit-policy'

const policyOf = (args: { muted?: string; urgent?: string }) => ({
  muted: authorListOf(args.muted ?? ''),
  urgent: authorListOf(args.urgent ?? ''),
})

describe('authorListOf', () => {
  it('splits, trims, lowercases and drops empties', () => {
    expect([...authorListOf(' Vercel , ,github-actions,')]).toEqual(['vercel', 'github-actions'])
  })

  it('strips a trailing [bot] suffix', () => {
    expect([...authorListOf('vercel[bot], Netlify[BOT]')]).toEqual(['vercel', 'netlify'])
  })

  it('reads an empty string as no authors', () => {
    expect(authorListOf('').size).toBe(0)
  })
})

describe('editDispositionOf', () => {
  it('mutes a listed author with or without the bot suffix', () => {
    const policy = policyOf({ muted: 'vercel' })
    expect(editDispositionOf({ authorLogin: 'vercel[bot]', policy })).toBe(EEditDisposition.Muted)
    expect(editDispositionOf({ authorLogin: 'Vercel', policy })).toBe(EEditDisposition.Muted)
  })

  it('marks a listed urgent author urgent', () => {
    const policy = policyOf({ urgent: 'chatgpt-codex-connector' })
    expect(editDispositionOf({ authorLogin: 'chatgpt-codex-connector[bot]', policy })).toBe(
      EEditDisposition.Urgent,
    )
  })

  it('lets muted win over urgent', () => {
    const policy = policyOf({ muted: 'bot-a', urgent: 'bot-a' })
    expect(editDispositionOf({ authorLogin: 'bot-a', policy })).toBe(EEditDisposition.Muted)
  })

  it('treats everyone else, and a missing author, as routine', () => {
    const policy = policyOf({ muted: 'vercel' })
    expect(editDispositionOf({ authorLogin: 'octocat', policy })).toBe(EEditDisposition.Routine)
    expect(editDispositionOf({ authorLogin: undefined, policy })).toBe(EEditDisposition.Routine)
  })

  it('defaults to muting the status bots and urging nobody', () => {
    for (const login of ['vercel[bot]', 'github-actions', 'netlify', 'mintlify']) {
      expect(editDispositionOf({ authorLogin: login, policy: DEFAULT_PR_EDIT_POLICY })).toBe(
        EEditDisposition.Muted,
      )
    }
    expect(DEFAULT_PR_EDIT_POLICY.urgent.size).toBe(0)
  })
})
