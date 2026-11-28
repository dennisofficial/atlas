import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'bun:test'

import appConfig from '../app.config'

const appRoot = resolve(import.meta.dir, '..')

const pngSizeOf = (path: string) => {
  const png = readFileSync(resolve(appRoot, path))
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

describe('app icons', () => {
  it('selects separate light and dark iOS icons', () => {
    expect(appConfig().ios?.icon).toEqual({
      light: './assets/images/icon.png',
      dark: './assets/images/icon-dark.png',
    })
  })

  it('ships full-size native icons and keeps the web favicon', () => {
    const config = appConfig()
    const icons = config.ios?.icon
    if (!icons || typeof icons === 'string') throw new Error('no iOS icon variants')
    if (!icons.light || !icons.dark || !config.web?.favicon) throw new Error('missing app icon')
    expect(pngSizeOf(icons.light)).toEqual({ width: 1024, height: 1024 })
    expect(pngSizeOf(icons.dark)).toEqual({ width: 1024, height: 1024 })
    expect(config.icon).toBe(icons.light)
    expect(pngSizeOf(config.web.favicon)).toEqual({ width: 48, height: 48 })
  })
})
