import { describe, expect, it } from 'bun:test'

import { EForge } from '../pure'
import {
  BAD_NUMBER_ERROR,
  labelOf,
  NO_CHECKOUT_ERROR,
  NO_PULL_REQUEST_ERROR,
  NOT_GITHUB_ERROR,
  resolveSubscriptionTarget,
  targetKey,
  targetOf,
  UNRECOGNIZED_ERROR,
} from '../subscription-target'
import { aCheckout } from '../testing'

const CHECKOUT = aCheckout()
const EXPECTED = {
  target: { repo: 'github.com/dennisofficial/atlas', number: 42 },
  label: 'dennisofficial/atlas#42',
}

const resolve = (args: {
  input: string
  checkout?: ReturnType<typeof aCheckout> | null
  foundNumber?: number | null
}) =>
  resolveSubscriptionTarget({
    input: args.input,
    checkout: args.checkout === undefined ? CHECKOUT : args.checkout,
    foundNumber: args.foundNumber === undefined ? 42 : args.foundNumber,
  })

describe('resolveSubscriptionTarget', () => {
  it('takes a blank input from the checkout’s found pull request', () => {
    expect(resolve({ input: '' })).toEqual(EXPECTED)
    expect(resolve({ input: '   ' })).toEqual(EXPECTED)
  })

  it('refuses a blank input when the checkout has no found pull request or there is no checkout', () => {
    expect(resolve({ input: '', foundNumber: null })).toEqual({ error: NO_PULL_REQUEST_ERROR })
    expect(resolve({ input: '', checkout: null })).toEqual({ error: NO_PULL_REQUEST_ERROR })
  })

  it('takes #123 and 123 from the checkout’s repository', () => {
    expect(resolve({ input: '#42', foundNumber: null })).toEqual(EXPECTED)
    expect(resolve({ input: '42', foundNumber: null })).toEqual(EXPECTED)
  })

  it('refuses a bare number with no checkout', () => {
    expect(resolve({ input: '#42', checkout: null })).toEqual({ error: NO_CHECKOUT_ERROR })
  })

  it('refuses a GitHub Enterprise checkout, which a github.com target cannot name', () => {
    const enterprise = aCheckout({ host: 'acme.ghe.com' })

    expect(resolve({ input: '', checkout: enterprise })).toEqual({ error: NOT_GITHUB_ERROR })
    expect(resolve({ input: '#42', checkout: enterprise })).toEqual({ error: NOT_GITHUB_ERROR })
  })

  it('resolves the same pull request whatever the casing of the reference', () => {
    const lower = resolve({ input: 'dltech/atlas#12', checkout: null })

    expect(lower).toEqual({
      target: { repo: 'github.com/dltech/atlas', number: 12 },
      label: 'dltech/atlas#12',
    })
    expect(resolve({ input: 'DLTech/Atlas#12', checkout: null })).toEqual(lower)
    expect(resolve({ input: 'https://github.com/DLTech/Atlas/pull/12', checkout: null })).toEqual(
      lower,
    )
  })

  it('lowercases the repository taken from a checkout', () => {
    const mixed = aCheckout({ owner: 'DLTech', repo: 'Atlas' })

    expect(resolve({ input: '#42', checkout: mixed })).toEqual({
      target: { repo: 'github.com/dltech/atlas', number: 42 },
      label: 'dltech/atlas#42',
    })
  })

  it('refuses a bare number on a checkout that is not on github.com', () => {
    const other = aCheckout({ forge: EForge.Other })

    expect(resolve({ input: '#42', checkout: other })).toEqual({ error: NOT_GITHUB_ERROR })
    expect(resolve({ input: '', checkout: other })).toEqual({ error: NOT_GITHUB_ERROR })
  })

  it('takes owner/repo#number whatever the checkout', () => {
    expect(resolve({ input: 'dennisofficial/atlas#42', checkout: null })).toEqual(EXPECTED)
    expect(resolve({ input: 'a-b/c.d_e#7' })).toEqual({
      target: { repo: 'github.com/a-b/c.d_e', number: 7 },
      label: 'a-b/c.d_e#7',
    })
  })

  it('parses a pull request URL, with or without a trailing path, query or fragment', () => {
    for (const input of [
      'https://github.com/dennisofficial/atlas/pull/42',
      'https://github.com/dennisofficial/atlas/pull/42/',
      'https://github.com/dennisofficial/atlas/pull/42/files',
      'https://github.com/dennisofficial/atlas/pull/42#issuecomment-1',
      'https://github.com/dennisofficial/atlas/pull/42?diff=split',
      'http://github.com/dennisofficial/atlas/pull/42',
    ]) {
      expect(resolve({ input, checkout: null })).toEqual(EXPECTED)
    }
  })

  it('refuses a zero number in every form', () => {
    for (const input of ['#0', '0', 'a/b#0', 'https://github.com/a/b/pull/0']) {
      expect(resolve({ input })).toEqual({ error: BAD_NUMBER_ERROR })
    }
  })

  it('refuses anything else, including other hosts and issue URLs', () => {
    for (const input of [
      'soon',
      'owner/repo',
      '#12a',
      'https://gitlab.com/a/b/pull/3',
      'https://github.com/a/b/issues/3',
      'https://github.com/a/b',
    ]) {
      expect(resolve({ input })).toEqual({ error: UNRECOGNIZED_ERROR })
    }
  })

  it('writes the target keys in repo, number order', () => {
    const resolved = resolve({ input: '#42' })

    expect('target' in resolved && JSON.stringify(resolved.target)).toBe(
      '{"repo":"github.com/dennisofficial/atlas","number":42}',
    )
  })
})

describe('target helpers', () => {
  it('reads a stored target back and rejects malformed ones', () => {
    expect(targetOf({ repo: 'github.com/a/b', number: 3 })).toEqual({
      repo: 'github.com/a/b',
      number: 3,
    })
    for (const value of [
      null,
      [],
      'x',
      {},
      { repo: 'gitlab.com/a/b', number: 3 },
      { repo: 'github.com/a/b', number: 0 },
      { repo: 'github.com/a/b', number: 1.5 },
      { repo: 'github.com/a/b', number: '3' },
    ]) {
      expect(targetOf(value)).toBeNull()
    }
  })

  it('reads a stored target with other casing back lowercase', () => {
    expect(targetOf({ repo: 'GitHub.com/DLTech/Atlas', number: 3 })).toEqual({
      repo: 'github.com/dltech/atlas',
      number: 3,
    })
  })

  it('labels and keys a target', () => {
    const target = { repo: 'github.com/a/b', number: 3 }

    expect(labelOf(target)).toBe('a/b#3')
    expect(targetKey(target)).toBe('github.com/a/b#3')
    expect(labelOf({ repo: 'github.com/A/B', number: 3 })).toBe('a/b#3')
    expect(targetKey({ repo: 'github.com/A/B', number: 3 })).toBe('github.com/a/b#3')
  })
})
