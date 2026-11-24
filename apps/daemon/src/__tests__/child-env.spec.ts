import { describe, expect, it } from 'bun:test'

import { ATLAS_VOLUME_BUN_CACHE, sanitizeChildEnv, withVolumeBunCache } from '../child-env'

describe('sanitizeChildEnv', () => {
  it('drops the mise shim vars a shim sets, so children cannot see which tool it picked', () => {
    const sanitized = sanitizeChildEnv({
      __MISE_SHIM: '/opt/mise/installs/bun/latest/bin/bun',
      __MISE_DIFF: '{"path":{}}',
      HOME: '/atlas/home',
    })

    expect(sanitized).toEqual({ HOME: '/atlas/home' })
  })

  it('drops the install dirs a shim prepended to PATH, keeping every other entry in order', () => {
    const sanitized = sanitizeChildEnv({
      PATH: '/opt/mise/installs/node/22.11.0/bin:/opt/mise/installs/python/3.12.7/bin:/opt/mise/shims:/usr/local/bin:/opt/mise/installs:/usr/bin',
    })

    expect(sanitized.PATH).toBe('/opt/mise/shims:/usr/local/bin:/usr/bin')
    expect(sanitized.MISE_DATA_DIR).toBe('/opt/mise')
  })

  it('follows MISE_DATA_DIR when the image moved the installs', () => {
    const sanitized = sanitizeChildEnv({
      MISE_DATA_DIR: '/mnt/mise',
      PATH: '/mnt/mise/installs/bun/1.4.4/bin:/opt/mise/installs/bun/1.4.4/bin:/opt/mise/shims',
    })

    expect(sanitized.PATH).toBe('/opt/mise/installs/bun/1.4.4/bin:/opt/mise/shims')
    expect(sanitized.MISE_DATA_DIR).toBe('/mnt/mise')
  })

  it('keeps a PATH that carries no install dir byte for byte', () => {
    const sanitized = sanitizeChildEnv({ PATH: '/opt/mise/shims:/opt/corepack/bin:/opt/bun/bin' })

    expect(sanitized.PATH).toBe('/opt/mise/shims:/opt/corepack/bin:/opt/bun/bin')
  })

  it('leaves a PATH-less env alone beyond the shim vars', () => {
    const sanitized = sanitizeChildEnv({ MISE_DATA_DIR: '/opt/mise', LANG: 'C.UTF-8' })

    expect(sanitized).toEqual({ MISE_DATA_DIR: '/opt/mise', LANG: 'C.UTF-8' })
  })

  it('strips the shim vars without dropping the rest of an ordinary env', () => {
    const sanitized = sanitizeChildEnv({
      HOME: '/atlas/home',
      LANG: 'C.UTF-8',
      __MISE_SHIM: '1',
      PATH: '/opt/mise/shims:/usr/bin',
    })

    expect(sanitized).toEqual({
      HOME: '/atlas/home',
      LANG: 'C.UTF-8',
      PATH: '/opt/mise/shims:/usr/bin',
      MISE_DATA_DIR: '/opt/mise',
    })
  })
})

describe('withVolumeBunCache', () => {
  it('points bun at the cache on the /atlas volume when the pod has one', () => {
    const env = withVolumeBunCache({ env: { HOME: '/atlas/home' }, atlasVolume: true })

    expect(env).toEqual({
      HOME: '/atlas/home',
      BUN_INSTALL_CACHE_DIR: ATLAS_VOLUME_BUN_CACHE,
    })
  })

  it('keeps a cache dir the environment already names', () => {
    const env = withVolumeBunCache({
      env: { BUN_INSTALL_CACHE_DIR: '/mnt/cache' },
      atlasVolume: true,
    })

    expect(env.BUN_INSTALL_CACHE_DIR).toBe('/mnt/cache')
  })

  it('treats an empty cache dir as unset', () => {
    const env = withVolumeBunCache({
      env: { BUN_INSTALL_CACHE_DIR: '' },
      atlasVolume: true,
    })

    expect(env.BUN_INSTALL_CACHE_DIR).toBe(ATLAS_VOLUME_BUN_CACHE)
  })

  it('leaves the env alone when the pod has no volume', () => {
    const original = { HOME: '/root' }
    const env = withVolumeBunCache({ env: original, atlasVolume: false })

    expect(env).toBe(original)
  })
})
