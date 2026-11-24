import { describe, expect, it } from 'bun:test'

import {
  CARD_EDGE_GAP,
  EUpdateCardAction,
  EUpdateCardKind,
  updateCardFrameOf,
  updateCardOf,
} from '../update-card-state'

const idle = {
  enabled: true,
  dismissed: false,
  isUpdateAvailable: false,
  isUpdatePending: false,
  isDownloading: false,
}

describe('updateCardOf', () => {
  it('shows nothing without an update', () => {
    expect(updateCardOf(idle)).toBeNull()
  })

  it('shows nothing when updates are disabled or the card was dismissed', () => {
    expect(updateCardOf({ ...idle, enabled: false, isUpdatePending: true })).toBeNull()
    expect(updateCardOf({ ...idle, dismissed: true, isUpdateAvailable: true })).toBeNull()
  })

  it('prefers the ready state over a download still reported by the hook', () => {
    const model = updateCardOf({
      ...idle,
      isUpdateAvailable: true,
      isUpdatePending: true,
      isDownloading: true,
    })
    expect(model?.kind).toBe(EUpdateCardKind.Ready)
    expect(model?.action).toBe(EUpdateCardAction.Restart)
    expect(model?.actionLabel).toBe('Restart')
    expect(model?.dismissible).toBe(true)
  })

  it('reports an in-flight download without an action', () => {
    const model = updateCardOf({ ...idle, isUpdateAvailable: true, isDownloading: true })
    expect(model?.kind).toBe(EUpdateCardKind.Downloading)
    expect(model?.action).toBeNull()
    expect(model?.actionLabel).toBeNull()
    expect(model?.dismissible).toBe(false)
  })

  it('offers a download when the update is available but not downloaded', () => {
    const model = updateCardOf({ ...idle, isUpdateAvailable: true })
    expect(model?.kind).toBe(EUpdateCardKind.Downloadable)
    expect(model?.action).toBe(EUpdateCardAction.Download)
    expect(model?.actionLabel).toBe('Download')
    expect(model?.dismissible).toBe(true)
  })
})

describe('updateCardFrameOf', () => {
  it('keeps the card clear of the right system column on iPhone Duo', () => {
    expect(
      updateCardFrameOf({ insets: { top: 0, right: 80, bottom: 21, left: 0 }, below: 56 }),
    ).toEqual({ top: 56, left: CARD_EDGE_GAP, right: 80 + CARD_EDGE_GAP })
  })

  it('sits below the status bar and the header on a plain iPhone', () => {
    expect(
      updateCardFrameOf({ insets: { top: 54, right: 0, bottom: 34, left: 0 }, below: 56 }),
    ).toEqual({ top: 54 + 56, left: CARD_EDGE_GAP, right: CARD_EDGE_GAP })
  })
})
