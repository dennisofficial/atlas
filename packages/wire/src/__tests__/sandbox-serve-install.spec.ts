import { describe, expect, it } from 'bun:test'

import { serveInstallScript } from '../sandbox-serve-install.js'

describe('the serve install script', () => {
  it('stages to a per-process name so concurrent installs never collide on a shared staging file', () => {
    const script = serveInstallScript({ version: '1.92.2' })
    expect(script).toContain('.next.$$')
    expect(script).not.toContain('.next"')
    expect(script).toContain('mv -f "$_stage"')
    expect(script).toContain('rm -f "$_stage"')
  })

  it('still verifies the sha256 before staging', () => {
    const script = serveInstallScript({ version: '1.92.2' })
    expect(script.indexOf('sha256 mismatch')).toBeLessThan(script.indexOf('install -m 0755'))
  })
})
