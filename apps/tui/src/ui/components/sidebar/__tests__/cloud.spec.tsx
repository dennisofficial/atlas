import { ERunner } from '@dltech/atlas-core'
import { EConnectionView } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { cloudHeadingOf } from '../cloud'

describe('the sidebar cloud section heading', () => {
  it('reads Pod for a local runner', () => {
    expect(
      cloudHeadingOf({
        state: EConnectionView.Connected,
        runner: ERunner.Local,
      }),
    ).toBe('Pod')
  })

  it('reads Cloud for a vercel or unknown runner', () => {
    expect(
      cloudHeadingOf({
        state: EConnectionView.Connected,
        runner: ERunner.Vercel,
      }),
    ).toBe('Cloud')
    expect(cloudHeadingOf({ state: EConnectionView.Connected })).toBe('Cloud')
  })
})
