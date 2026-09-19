import { describe, expect, it } from 'bun:test'

import { EChannelConnection } from '@dltech/atlas-harness'

import { cloudConnectionItemOf, isAttaching } from '../cloud-connection-item'
import { EFooterItemReach } from '../footer-item'
import { spinnerFrame, theme } from '../theme'

const NOW = 1_700_000_000_000

const itemFor = (state: EChannelConnection) =>
  cloudConnectionItemOf({ connection: { state, detail: null }, now: NOW })

describe('the cloud-connection icon', () => {
  it('is absent when no cloud session is attached', () => {
    expect(cloudConnectionItemOf({ connection: null, now: NOW })).toBeNull()
  })

  it('is a resting cloud when the socket is open', () => {
    const item = itemFor(EChannelConnection.Open)

    expect(item?.spans).toEqual([{ text: '☁', fg: theme.ok }])
    expect(item?.ground).toBeUndefined()
    expect(item?.reach).toBe(EFooterItemReach.None)
  })

  it('is a moon when the sandbox is parked', () => {
    expect(itemFor(EChannelConnection.Parked)?.spans).toEqual([{ text: '☾', fg: theme.hint }])
  })

  it('is a failure mark when the sandbox is not answering', () => {
    expect(itemFor(EChannelConnection.Closed)?.spans).toEqual([{ text: '✗', fg: theme.warn }])
  })

  it('spins while attaching, and follows the clock', () => {
    for (const state of [
      EChannelConnection.Connecting,
      EChannelConnection.Reconnecting,
      EChannelConnection.Reattaching,
    ]) {
      const early = cloudConnectionItemOf({ connection: { state, detail: null }, now: 0 })
      const late = cloudConnectionItemOf({ connection: { state, detail: null }, now: 80 })

      expect(early?.spans[0]?.text).toBe(spinnerFrame(0))
      expect(late?.spans[0]?.text).toBe(spinnerFrame(80))
      expect(early?.spans[0]?.fg).toBe(theme.warn)
    }
  })

  it('counts only the attaching states as animated', () => {
    expect(isAttaching(EChannelConnection.Connecting)).toBe(true)
    expect(isAttaching(EChannelConnection.Reconnecting)).toBe(true)
    expect(isAttaching(EChannelConnection.Reattaching)).toBe(true)
    expect(isAttaching(EChannelConnection.Open)).toBe(false)
    expect(isAttaching(EChannelConnection.Parked)).toBe(false)
    expect(isAttaching(EChannelConnection.Closed)).toBe(false)
  })
})
