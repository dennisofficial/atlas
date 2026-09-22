import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  CANCEL_LABEL,
  CONFIRM_LABEL,
  HEADING,
  PurgeConfirm,
  RUNNING_LABEL,
  SIGN_OUT_NOTE,
  SUBTITLE,
} from '../components/purge-confirm'
import { openPurgeConfirm, runningPurgeConfirm } from '../purge-confirm-model'
import { frameOf, mount } from './transcript-fixture'

const WIDTH = 80

const dialog = (over: { running?: boolean; width?: number } = {}) => {
  const opened = openPurgeConfirm()
  return (
    <PurgeConfirm
      width={over.width ?? WIDTH}
      state={over.running === true ? runningPurgeConfirm(opened) : opened}
      overlay
      onConfirm={() => undefined}
      onDismiss={() => undefined}
    />
  )
}

describe('the download-and-purge confirmation', () => {
  it('says why it is asking', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(frame).toContain(HEADING)
    expect(frame).toContain(SUBTITLE)
  })

  it('lists what moves and what is deleted server-side', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(frame).toContain('model accounts and their credentials')
    expect(frame).toContain('secrets')
    expect(frame).toContain('MCP servers')
    expect(frame).toContain('your memory')
    expect(frame).toContain('your GitHub connection')
  })

  it('states that this signs you out', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(frame).toContain(SIGN_OUT_NOTE)
  })

  it('offers the way through and the way out, and says which keys take them', async () => {
    const frame = await frameOf(dialog(), WIDTH)

    expect(frame).toContain(CONFIRM_LABEL)
    expect(frame).toContain(CANCEL_LABEL)
    expect(frame).toContain('Enter to download & purge')
    expect(frame).toContain('Esc to cancel')
  })

  it('swaps the confirm for a working note while the purge runs', async () => {
    const frame = await frameOf(dialog({ running: true }), WIDTH)

    expect(frame).toContain(RUNNING_LABEL)
    expect(frame).not.toContain(CONFIRM_LABEL)
  })

  it('mounts at a narrow width without spilling', async () => {
    await expect(mount(dialog({ width: 40 }), 40)).resolves.toBeUndefined()
  })
})
