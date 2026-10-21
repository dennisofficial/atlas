import { describe, expect, it } from 'vitest'

import { EConnectionView } from '@dltech/atlas-harness'

import { cloudConnectionItemOf } from '../cloud-connection-item'
import { EFooterItemReach } from '../footer-item'
import { glyph, spinnerFrame, theme } from '../theme'

const NOW = 1_700_000_000_000

const itemFor = (state: EConnectionView, now = NOW) =>
  cloudConnectionItemOf({ connection: { state, detail: null }, now })

describe('the cloud-connection icon', () => {
  it('is absent when no cloud session is attached', () => {
    expect(cloudConnectionItemOf({ connection: null, now: NOW })).toBeNull()
  })

  it('is absent once the session has detached', () => {
    expect(itemFor(EConnectionView.Detached)).toBeNull()
  })

  it('is a resting cloud when connected', () => {
    const item = itemFor(EConnectionView.Connected)

    expect(item?.spans).toEqual([{ text: '☁', fg: theme.ok }])
    expect(item?.ground).toBeUndefined()
    expect(item?.reach).toBe(EFooterItemReach.None)
  })

  it('is a quiet moon when the sandbox is parked, never a fault colour', () => {
    expect(itemFor(EConnectionView.Parked)?.spans).toEqual([{ text: '☾', fg: theme.hint }])
  })

  it('is a failure mark when disconnected', () => {
    expect(itemFor(EConnectionView.Disconnected)?.spans).toEqual([{ text: glyph.failed, fg: theme.warn }])
  })

  it('spins and names the move while the container is in transition', () => {
    const named: ReadonlyArray<[EConnectionView, string]> = [
      [EConnectionView.Waking, ' waking'],
      [EConnectionView.Reconnecting, ' reconnecting'],
      [EConnectionView.Updating, ' updating'],
    ]
    for (const [state, label] of named) {
      expect(itemFor(state, 0)?.spans).toEqual([
        { text: spinnerFrame(0), fg: theme.warn },
        { text: label, fg: theme.warn },
      ])
      expect(itemFor(state, 80)?.spans[0]?.text).toBe(spinnerFrame(80))
    }
  })
})
