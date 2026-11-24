import { describe, expect, it } from 'bun:test'

import { isAtlasVolumeMounted } from '../atlas-volume'

describe('isAtlasVolumeMounted', () => {
  it('finds the volume when /atlas is a mount point', () => {
    const mounts = [
      'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0',
      '/dev/sda1 /atlas ext4 rw,relatime 0 0',
      '/dev/sdb1 /atlas/home ext4 rw,relatime 0 0',
    ].join('\n')

    expect(isAtlasVolumeMounted(mounts)).toBe(true)
  })

  it('ignores a nested mount when /atlas itself is not mounted', () => {
    const mounts = [
      'overlay /atlas/docker overlay rw,lowerdir=/mnt/lower,upperdir=/mnt/upper 0 0',
      '/dev/sda1 / ext4 rw,relatime 0 0',
    ].join('\n')

    expect(isAtlasVolumeMounted(mounts)).toBe(false)
  })

  it('reports no volume for a mounts text without entries', () => {
    expect(isAtlasVolumeMounted('')).toBe(false)
  })
})
