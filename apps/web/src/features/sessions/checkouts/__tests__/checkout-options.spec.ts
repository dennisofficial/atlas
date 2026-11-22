import { describe, expect, it } from 'bun:test'
import type { SessionChangesOutput, SessionViewOutput } from '@dltech/atlas-protocol'

import { checkoutOptionsOf, currentWorktreePathOf, defaultCheckoutIdOf } from '../checkout-options'

type Checkout = SessionChangesOutput['checkouts'][number]

const checkout = (overrides: Partial<Checkout> = {}): Checkout => ({
  checkoutId: 'co-1',
  repo: 'owner/atlas',
  worktreePath: '/work/atlas',
  base: 'main',
  updatedAt: 1,
  files: [],
  ...overrides,
})

const view = (
  overrides: Partial<SessionViewOutput['checkouts']> = {},
): SessionViewOutput['checkouts'] => ({
  repos: [],
  primary: null,
  ...overrides,
})

describe('checkoutOptionsOf', () => {
  it('labels a checkout with the branch that holds its worktree', () => {
    const options = checkoutOptionsOf({
      checkouts: [checkout()],
      view: view({
        repos: [
          {
            repo: 'owner/atlas',
            base: 'main',
            head: 'dennis/files-tab-checkouts',
            branches: [
              {
                name: 'dennis/files-tab-checkouts',
                sha: 'abc123',
                worktreePath: '/work/atlas',
              },
            ],
          },
        ],
        primary: { repo: 'owner/atlas', branch: 'dennis/files-tab-checkouts' },
      }),
    })
    expect(options).toHaveLength(1)
    expect(options[0]?.label).toBe('owner/atlas · dennis/files-tab-checkouts')
    expect(options[0]?.path).toBe('/work/atlas')
    expect(options[0]?.worktree).toBe('atlas')
  })

  it('labels a checkout with its worktree name when no branch names that worktree', () => {
    const options = checkoutOptionsOf({
      checkouts: [checkout({ worktreePath: '/work/wt-alpha' })],
      view: view(),
    })
    expect(options[0]?.label).toBe('owner/atlas · wt-alpha')
  })

  it('drops a checkout whose worktree the git inventory no longer holds', () => {
    const options = checkoutOptionsOf({
      checkouts: [
        checkout({ checkoutId: 'co-live', worktreePath: '/work/live' }),
        checkout({ checkoutId: 'co-gone', worktreePath: '/work/gone' }),
      ],
      view: view({
        repos: [
          {
            repo: '/work/atlas',
            base: 'main',
            head: 'dennis/live',
            branches: [{ name: 'dennis/live', sha: 'abc123', worktreePath: '/work/live' }],
          },
        ],
      }),
    })
    expect(options.map((option) => option.id)).toEqual(['co-live'])
  })

  it('keeps a checkout at the repository main checkout path', () => {
    const options = checkoutOptionsOf({
      checkouts: [checkout({ checkoutId: 'co-main', worktreePath: '/work/atlas' })],
      view: view({
        repos: [{ repo: '/work/atlas', base: 'main', head: 'main', branches: [] }],
      }),
    })
    expect(options.map((option) => option.id)).toEqual(['co-main'])
  })

  it('offers every checkout while the git inventory is empty', () => {
    const options = checkoutOptionsOf({
      checkouts: [
        checkout({ checkoutId: 'co-1', worktreePath: '/work/one' }),
        checkout({ checkoutId: 'co-2', worktreePath: '/work/two' }),
      ],
      view: view(),
    })
    expect(options.map((option) => option.id)).toEqual(['co-1', 'co-2'])
  })

  it('keeps one option per worktree, the newest row', () => {
    const options = checkoutOptionsOf({
      checkouts: [
        checkout({ checkoutId: 'co-old', worktreePath: '/work/atlas', updatedAt: 1 }),
        checkout({ checkoutId: 'co-new', worktreePath: '/work/atlas', updatedAt: 5 }),
      ],
      view: view(),
    })
    expect(options.map((option) => option.id)).toEqual(['co-new'])
  })

  it('keeps the order the changes API answered in', () => {
    const options = checkoutOptionsOf({
      checkouts: [
        checkout({ checkoutId: 'co-2', worktreePath: '/work/second' }),
        checkout({ checkoutId: 'co-1', worktreePath: '/work/first' }),
      ],
      view: view(),
    })
    expect(options.map((option) => option.id)).toEqual(['co-2', 'co-1'])
  })
})

describe('currentWorktreePathOf', () => {
  it('finds the worktree of the primary branch', () => {
    expect(
      currentWorktreePathOf(
        view({
          repos: [
            {
              repo: 'owner/atlas',
              base: 'main',
              head: 'dennis/wt',
              branches: [{ name: 'dennis/wt', sha: 'abc123', worktreePath: '/work/wt' }],
            },
          ],
          primary: { repo: 'owner/atlas', branch: 'dennis/wt' },
        }),
      ),
    ).toBe('/work/wt')
  })

  it('answers nothing without a primary branch', () => {
    expect(currentWorktreePathOf(view())).toBeUndefined()
  })
})

describe('defaultCheckoutIdOf', () => {
  const options = checkoutOptionsOf({
    checkouts: [
      checkout({ checkoutId: 'co-1', worktreePath: '/work/main' }),
      checkout({ checkoutId: 'co-2', worktreePath: '/work/sub' }),
    ],
    view: view(),
  })

  it('picks the checkout that holds the current worktree', () => {
    expect(defaultCheckoutIdOf({ options, currentWorktreePath: '/work/sub' })).toBe('co-2')
  })

  it('picks the first checkout when no worktree matches', () => {
    expect(defaultCheckoutIdOf({ options, currentWorktreePath: '/work/gone' })).toBe('co-1')
    expect(defaultCheckoutIdOf({ options })).toBe('co-1')
  })

  it('answers nothing without checkouts', () => {
    expect(defaultCheckoutIdOf({ options: [] })).toBeUndefined()
  })
})
