import { describe, expect, it } from 'bun:test'

import { withoutLauncherPrivateEnv } from '../child-env'

describe('withoutLauncherPrivateEnv', () => {
  it('drops the transpiler cache the source launcher keeps to itself', () => {
    const stripped = withoutLauncherPrivateEnv({
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: '/tmp/atlas-dev-transpiler-cache',
    })

    expect(stripped).toEqual({ PATH: '/usr/bin', NODE_ENV: 'production' })
  })

  it('hands back the same object when there is nothing to strip', () => {
    const env = { PATH: '/usr/bin' }

    expect(withoutLauncherPrivateEnv(env)).toBe(env)
  })
})
