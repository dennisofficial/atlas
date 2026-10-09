import { describe, expect, it } from 'bun:test'

import { CLOUD_WORKSPACE_PATH } from '../serve-env.js'

import { DRIVE_MOUNT_PATH, DRIVE_WORKSPACE_PATH } from '../sandbox-drive.js'

describe('the drive layout', () => {
  it('defaults the workspace to the unnamed cloud workspace beneath the mount', () => {
    expect(DRIVE_WORKSPACE_PATH).toBe(CLOUD_WORKSPACE_PATH)
    expect(DRIVE_WORKSPACE_PATH).toBe('/atlas/workspaces/workspace')
    expect(DRIVE_WORKSPACE_PATH.startsWith(`${DRIVE_MOUNT_PATH}/`)).toBe(true)
  })
})
