import { describe, expect, it } from 'bun:test'

import { stepDigestOf } from '../step-digest'

describe('stepDigestOf', () => {
  it('ignores the env the host injects', () => {
    const bare = { op: 'exec', command: 'gh pr list' }
    expect(stepDigestOf({ ...bare, env: { GH_TOKEN: 'one' } })).toBe(stepDigestOf(bare))
    expect(stepDigestOf({ ...bare, env: { GH_TOKEN: 'two' } })).toBe(stepDigestOf(bare))
  })

  it('ignores a tunnel token', () => {
    const bare = { op: 'exposePort', port: 3000 }
    expect(stepDigestOf({ ...bare, tunnelToken: 'abc' })).toBe(stepDigestOf(bare))
  })

  it('ignores the service id the daemon decides', () => {
    const bare = { op: 'services.start', command: 'listen', cwd: '/w' }
    expect(stepDigestOf({ ...bare, serviceId: 'svc-one00000' })).toBe(stepDigestOf(bare))
    expect(stepDigestOf({ ...bare, serviceId: 'svc-two00000' })).toBe(stepDigestOf(bare))
  })

  it('keeps the service id of every other pod operation', () => {
    expect(stepDigestOf({ op: 'services.stop', serviceId: 'svc-one00000' })).not.toBe(
      stepDigestOf({ op: 'services.stop', serviceId: 'svc-two00000' }),
    )
  })

  it('changes with the op as the plugin wrote it', () => {
    expect(stepDigestOf({ op: 'services.start', name: 'api' })).not.toBe(
      stepDigestOf({ op: 'services.start', name: 'db' }),
    )
  })

  it('does not depend on the order of the fields', () => {
    expect(stepDigestOf({ op: 'exec', command: 'ls', workdir: '/w' })).toBe(
      stepDigestOf({ workdir: '/w', command: 'ls', op: 'exec' }),
    )
  })
})
