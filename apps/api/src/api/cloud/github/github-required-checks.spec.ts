import { describe, expect, it } from 'bun:test'
import {
  recalledRequiredContexts,
  rememberRequiredContexts,
  requiredContextsFrom,
  requiredContextsKey,
  requiredContextsOf,
  type GithubPathRead,
  type RequiredContextsCache,
} from './github-required-checks'

const readOf = (answers: Record<string, GithubPathRead>) => async (path: string) =>
  answers[path] ?? { status: 404, body: null }

describe('requiredContextsOf', () => {
  it('unions the ruleset contexts with classic branch protection', () => {
    expect(
      requiredContextsOf({
        rules: [
          { type: 'deletion' },
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'ci' }] },
          },
        ],
        protection: { contexts: ['lint'], checks: [{ context: 'ci' }, { context: 'e2e' }] },
      }),
    ).toEqual(['ci', 'lint', 'e2e'])
  })

  it('answers nothing for a branch with no rules and no protection', () => {
    expect(requiredContextsOf({ rules: [], protection: null })).toEqual([])
  })
})

describe('requiredContextsFrom', () => {
  const args = { owner: 'dennisofficial', repo: 'atlas', branch: 'main' }

  it('reads the branch rulesets, the source of a ruleset-required context', async () => {
    expect(
      await requiredContextsFrom({
        ...args,
        read: readOf({
          '/repos/dennisofficial/atlas/rules/branches/main': {
            status: 200,
            body: [
              {
                type: 'required_status_checks',
                parameters: { required_status_checks: [{ context: 'ci' }] },
              },
            ],
          },
        }),
      }),
    ).toEqual(['ci'])
  })

  it('falls back to classic protection when no ruleset requires a check', async () => {
    expect(
      await requiredContextsFrom({
        ...args,
        read: readOf({
          '/repos/dennisofficial/atlas/rules/branches/main': { status: 200, body: [] },
          '/repos/dennisofficial/atlas/branches/main/protection/required_status_checks': {
            status: 200,
            body: { contexts: ['ci'], checks: [{ context: 'ci' }] },
          },
        }),
      }),
    ).toEqual(['ci'])
  })

  it('answers unknown when neither source could be read', async () => {
    expect(
      await requiredContextsFrom({
        ...args,
        read: async () => {
          throw new Error('github down')
        },
      }),
    ).toBeNull()
  })

  it('answers no required checks when both sources read and require nothing', async () => {
    expect(
      await requiredContextsFrom({
        ...args,
        read: readOf({
          '/repos/dennisofficial/atlas/rules/branches/main': { status: 200, body: [] },
          '/repos/dennisofficial/atlas/branches/main/protection/required_status_checks': {
            status: 200,
            body: {},
          },
        }),
      }),
    ).toEqual([])
  })
})

describe('required context cache', () => {
  it('serves a remembered answer within its ttl and forgets it after', () => {
    const cache: RequiredContextsCache = new Map()
    const key = requiredContextsKey({ owner: 'compai', repo: 'app', branch: 'main' })
    expect(recalledRequiredContexts({ cache, key, now: 1_000 })).toBeUndefined()
    rememberRequiredContexts({ cache, key, now: 1_000, contexts: ['ci'] })
    expect(recalledRequiredContexts({ cache, key, now: 60_999 })).toEqual(['ci'])
    expect(recalledRequiredContexts({ cache, key, now: 61_001 })).toBeUndefined()
  })
})
