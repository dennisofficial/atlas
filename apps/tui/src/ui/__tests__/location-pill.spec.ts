import { describe, expect, it } from 'bun:test'

import { ERunner } from '@dltech/atlas-core'

import { EFooterItemReach, pressOf } from '../footer-item'
import { locationPillOf, PLACEMENT_CHIP_ID } from '../location-pill'
import { theme } from '../theme'

describe('the execution-location pill', () => {
  it('is absent when the session is not placed', () => {
    expect(locationPillOf({ placed: false })).toBeNull()
  })

  it('is plain display once the thread runs in the cloud', () => {
    const chip = locationPillOf({ placed: true })

    expect(chip?.spans).toEqual([{ text: 'cloud', fg: theme.appBg }])
    expect(chip?.reach).toBe(EFooterItemReach.None)
    expect(chip?.onActivate).toBeUndefined()
  })
})

describe('the placement chip before the first send', () => {
  const flips: string[] = []
  const onFlip = (): void => void flips.push('flip')

  it('reads pod with a caret and flips on activation when the preference is a local pod', () => {
    const chip = locationPillOf({
      placed: false,
      placement: { runner: ERunner.Local, provisioning: false, onFlip },
    })

    expect(chip?.id).toBe(PLACEMENT_CHIP_ID)
    expect(chip?.spans).toEqual([{ text: ' pod ▾ ', fg: theme.appBg }])
    expect(chip?.ground).toBe(theme.link)
    expect(chip?.reach).toBe(EFooterItemReach.Keyboard)
    chip?.onActivate?.()
    expect(flips).toEqual(['flip'])
  })

  it('reads cloud with a caret when the preference is a Vercel sandbox', () => {
    const chip = locationPillOf({
      placed: false,
      placement: { runner: ERunner.Vercel, provisioning: false, onFlip },
    })

    expect(chip?.spans).toEqual([{ text: ' ☁ cloud ▾ ', fg: theme.appBg }])
    expect(chip?.reach).toBe(EFooterItemReach.Keyboard)
    chip?.onActivate?.()
    expect(flips).toEqual(['flip', 'flip'])
  })

  it('goes inert, warm and caret-free while the pod is still provisioning', () => {
    const chip = locationPillOf({
      placed: false,
      placement: { runner: ERunner.Local, provisioning: true, onFlip },
    })

    expect(chip?.spans).toEqual([{ text: ' pod ', fg: theme.appBg }])
    expect(chip?.ground).toBe(theme.warn)
    expect(chip?.reach).toBe(EFooterItemReach.None)
    expect(chip?.onActivate).toBeUndefined()
  })
})

describe('the placement chip of a born thread', () => {
  it('shows its runner without a caret, a press, or a hover', () => {
    const chip = locationPillOf({
      placed: true,
      placement: { runner: ERunner.Local, provisioning: false },
    })

    expect(chip?.spans).toEqual([{ text: ' pod ', fg: theme.appBg }])
    expect(chip?.ground).toBe(theme.link)
    expect(chip?.reach).toBe(EFooterItemReach.None)
    expect(chip === null ? undefined : pressOf(chip)).toBeUndefined()
  })
})
