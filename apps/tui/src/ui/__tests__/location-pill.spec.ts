import { describe, expect, it } from 'vitest'

import { EExecutionLocation, EHarnessPlacement, ERunner } from '@dltech/atlas-core'

import { EFooterItemReach } from '../footer-item'
import { locationPillOf, PLACEMENT_CHIP_ID } from '../location-pill'
import { theme } from '../theme'

describe('the execution-location pill', () => {
  it('is absent when the conversation runs on the host', () => {
    expect(locationPillOf({ location: EExecutionLocation.Host })).toBeNull()
  })

  it('is a blue docker chip when the conversation runs in a container', () => {
    const pill = locationPillOf({ location: EExecutionLocation.Docker })

    expect(pill?.spans).toEqual([{ text: 'docker', fg: theme.appBg }])
    expect(pill?.ground).toBe(theme.link)
    expect(pill?.reach).toBe(EFooterItemReach.None)
  })
})

describe('the placement chip before the first send', () => {
  const flips: string[] = []
  const onFlip = (): void => void flips.push('flip')

  it('reads host with a caret and flips on activation when the thread will start on the host', () => {
    const chip = locationPillOf({
      location: EExecutionLocation.Host,
      placement: { harness: EHarnessPlacement.Host, provisioning: false, onFlip },
    })

    expect(chip?.id).toBe(PLACEMENT_CHIP_ID)
    expect(chip?.spans).toEqual([{ text: ' host ▾ ', fg: theme.appBg }])
    expect(chip?.reach).toBe(EFooterItemReach.Keyboard)
    chip?.onActivate?.()
    expect(flips).toEqual(['flip'])
  })

  it('reads pod with a caret when the thread will start in a local pod', () => {
    const chip = locationPillOf({
      location: EExecutionLocation.Cloud,
      placement: {
        harness: EHarnessPlacement.Cloud,
        runner: ERunner.Local,
        provisioning: false,
        onFlip,
      },
    })

    expect(chip?.spans).toEqual([{ text: ' pod ▾ ', fg: theme.appBg }])
    expect(chip?.ground).toBe(theme.link)
  })

  it('reads cloud with a caret when the thread will start in a Vercel sandbox', () => {
    const chip = locationPillOf({
      location: EExecutionLocation.Cloud,
      placement: {
        harness: EHarnessPlacement.Cloud,
        runner: ERunner.Vercel,
        provisioning: false,
        onFlip,
      },
    })

    expect(chip?.spans).toEqual([{ text: ' ☁ cloud ▾ ', fg: theme.appBg }])
    expect(chip?.ground).toBe(theme.link)
    expect(chip?.reach).toBe(EFooterItemReach.Keyboard)
    chip?.onActivate?.()
    expect(flips).toEqual(['flip', 'flip'])
  })

  it('goes inert, warm and caret-free while the sandbox is still provisioning', () => {
    const chip = locationPillOf({
      location: EExecutionLocation.Host,
      placement: { harness: EHarnessPlacement.Cloud, provisioning: true, onFlip },
    })

    expect(chip?.spans).toEqual([{ text: ' ☁ cloud ', fg: theme.appBg }])
    expect(chip?.ground).toBe(theme.warn)
    expect(chip?.reach).toBe(EFooterItemReach.None)
    expect(chip?.onActivate).toBeUndefined()
  })

  it('is plain display once the thread has started', () => {
    const chip = locationPillOf({ location: EExecutionLocation.Cloud })

    expect(chip?.spans).toEqual([{ text: EExecutionLocation.Cloud, fg: theme.appBg }])
    expect(chip?.reach).toBe(EFooterItemReach.None)
    expect(chip?.onActivate).toBeUndefined()
  })
})
