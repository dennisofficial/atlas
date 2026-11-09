import { describe, expect, it } from 'bun:test'

import { EUpdateCardAction, EUpdateCardKind, updateCardOf } from '../update-card-state'

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
