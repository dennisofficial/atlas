import { describe, expect, it } from 'bun:test'

import { RESIZE_MAX_DISK_GB } from '@dltech/atlas-native-commands'

import { POD_RESIZE_MAX_DISK_GB } from '../pod-resize'

describe('POD_RESIZE_MAX_DISK_GB', () => {
  it('matches the resize ceiling the sandbox command enforces', () => {
    expect(POD_RESIZE_MAX_DISK_GB).toBe(RESIZE_MAX_DISK_GB)
  })
})
