import { describe, expect, it } from 'bun:test'

import type { CheckoutOption } from '../../checkouts/checkout-options'
import { checkoutPathOf, contextPathOf } from '../pane-open'

const option = (overrides: Partial<CheckoutOption> = {}): CheckoutOption => ({
  id: 'co-1',
  repo: 'owner/atlas',
  worktree: 'atlas',
  path: '/work/atlas',
  label: 'owner/atlas, main',
  ...overrides,
})

describe('contextPathOf', () => {
  it('reads the dollar env prefix', () => {
    expect(contextPathOf({ path: '$ATLAS_CONTEXT_DIR/plan.md', sessionId: 'ses-1' })).toBe(
      'plan.md',
    )
  })

  it('reads the braced env prefix', () => {
    expect(contextPathOf({ path: '${ATLAS_CONTEXT_DIR}/sections/01.md', sessionId: 'ses-1' })).toBe(
      'sections/01.md',
    )
  })

  it('reads the pod path for this session', () => {
    expect(
      contextPathOf({ path: '/atlas/home/sessions/ses-1/context/plan.md', sessionId: 'ses-1' }),
    ).toBe('plan.md')
  })

  it('answers nothing for another session or an ordinary path', () => {
    expect(
      contextPathOf({ path: '/atlas/home/sessions/ses-2/context/plan.md', sessionId: 'ses-1' }),
    ).toBeUndefined()
    expect(contextPathOf({ path: 'src/app.ts', sessionId: 'ses-1' })).toBeUndefined()
    expect(contextPathOf({ path: '$ATLAS_CONTEXT_DIR/', sessionId: 'ses-1' })).toBeUndefined()
  })
})

describe('checkoutPathOf', () => {
  it('maps an absolute path under a checkout to that checkout and the relative rest', () => {
    expect(
      checkoutPathOf({ path: '/work/atlas/src/app.ts', options: [option()], selectedId: 'co-9' }),
    ).toEqual({ checkoutId: 'co-1', path: 'src/app.ts' })
  })

  it('lets the longest matching checkout win', () => {
    const nested = option({ id: 'co-2', path: '/work/atlas/packages/core' })
    expect(
      checkoutPathOf({
        path: '/work/atlas/packages/core/src/a.ts',
        options: [option(), nested],
        selectedId: 'co-1',
      }),
    ).toEqual({ checkoutId: 'co-2', path: 'src/a.ts' })
  })

  it('does not match a sibling directory that only shares a prefix', () => {
    expect(
      checkoutPathOf({
        path: '/work/atlas-two/src/a.ts',
        options: [option()],
        selectedId: 'co-1',
      }),
    ).toBeUndefined()
  })

  it('sends a relative path to the selected checkout', () => {
    expect(checkoutPathOf({ path: 'src/app.ts', options: [option()], selectedId: 'co-1' })).toEqual(
      { checkoutId: 'co-1', path: 'src/app.ts' },
    )
    expect(
      checkoutPathOf({ path: './src/app.ts', options: [option()], selectedId: 'co-1' }),
    ).toEqual({ checkoutId: 'co-1', path: 'src/app.ts' })
  })

  it('answers nothing for a relative path without a selected checkout or an escape', () => {
    expect(
      checkoutPathOf({ path: 'src/app.ts', options: [option()], selectedId: undefined }),
    ).toBeUndefined()
    expect(
      checkoutPathOf({ path: '../secret', options: [option()], selectedId: 'co-1' }),
    ).toBeUndefined()
  })

  it('answers nothing for an absolute path outside every checkout', () => {
    expect(
      checkoutPathOf({ path: '/etc/passwd', options: [option()], selectedId: 'co-1' }),
    ).toBeUndefined()
  })
})
