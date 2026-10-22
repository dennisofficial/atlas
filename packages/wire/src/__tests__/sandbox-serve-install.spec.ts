import { describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire.js'
import {
  EServeArch,
  serveInstallScript,
  serveStageAndStampSteps,
} from '../sandbox-serve-install.js'
import { SERVE_BINARY_PATH, SERVE_PROTOCOL_PATH, SERVE_VERSION_PATH } from '../serve-env.js'

describe('the shared stage-and-stamp steps', () => {
  it('stages per-process, renames atomically, then writes both stamps', () => {
    const steps = serveStageAndStampSteps({ source: '/tmp/x/atlas-serve', version: 'dev-abc' })
    expect(steps).toEqual([
      `_stage="${SERVE_BINARY_PATH}.next.$$"`,
      `trap 'rm -f "$_stage"' EXIT`,
      `install -m 0755 "/tmp/x/atlas-serve" "$_stage"`,
      `mv -f "$_stage" "${SERVE_BINARY_PATH}"`,
      `printf '%s' 'dev-abc' > "${SERVE_VERSION_PATH}"`,
      `printf '%s' '${CHANNEL_PROTOCOL_VERSION}' > "${SERVE_PROTOCOL_PATH}"`,
    ])
  })

  it('folds extra cleanup into the same trap so the stage file is never orphaned', () => {
    const steps = serveStageAndStampSteps({
      source: '$_tmp/atlas-serve',
      version: '1.0.0',
      extraCleanup: 'rm -rf "$_tmp"',
    })
    expect(steps[1]).toBe(`trap 'rm -rf "$_tmp"; rm -f "$_stage"' EXIT`)
  })

  it('is the tail of the release install script', () => {
    const tail = serveStageAndStampSteps({
      source: '$_tmp/atlas-serve',
      version: '1.92.2',
      extraCleanup: 'rm -rf "$_tmp"',
    }).join(' && ')
    expect(serveInstallScript({ version: '1.92.2' }).endsWith(tail)).toBe(true)
  })
})

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

describe('the serve install script architecture', () => {
  it('defaults to x64 and matches the explicit x64 script byte for byte', () => {
    const script = serveInstallScript({ version: '1.92.2' })
    expect(script).toBe(serveInstallScript({ version: '1.92.2', arch: EServeArch.X64 }))
    expect(script).toContain('/releases/download/tui-v1.92.2/atlas-serve-linux-x64"')
    expect(script).toContain('/releases/download/tui-v1.92.2/atlas-serve-linux-x64.sha256"')
  })

  it('downloads the arm64 asset and its checksum and never the x64 one', () => {
    const script = serveInstallScript({ version: '1.92.2', arch: EServeArch.Arm64 })
    expect(script).toContain('/releases/download/tui-v1.92.2/atlas-serve-linux-arm64"')
    expect(script).toContain('/releases/download/tui-v1.92.2/atlas-serve-linux-arm64.sha256"')
    expect(script).not.toContain('linux-x64')
  })

  it('resolves the arm64 asset from the latest release when no version is pinned', () => {
    const script = serveInstallScript({ version: undefined, arch: EServeArch.Arm64 })
    expect(script).toContain('/releases/latest/download/atlas-serve-linux-arm64"')
  })
})
