import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  it('downloads the binary and checksum concurrently with retry flags on both', () => {
    const script = serveInstallScript({ version: '1.92.2' })
    const flags = '--retry 3 --retry-connrefused --retry-delay 1 --connect-timeout 10'
    expect(script.split(flags)).toHaveLength(3)
    expect(script).toContain('-o "$_tmp/atlas-serve" & _bin=$!')
    expect(script).toContain('wait $_bin ||')
    expect(script).toContain('wait $_sum ||')
  })
})

describe('the serve install script download phase', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const runDownloadPhase = async () => {
    const script = serveInstallScript({ version: '1.92.2' })
    const phase = script.slice(0, script.indexOf(' && _expected='))
    const root = await mkdtemp(join(tmpdir(), 'atlas-install-fake-'))
    roots.push(root)
    const pidFile = join(root, 'sum.pid')
    const curl = join(root, 'curl')
    await writeFile(
      curl,
      [
        '#!/bin/sh',
        'eval "last=\\${$#}"',
        `case "$last" in *.sha256) echo $$ > "${pidFile}"; exec sleep 30;; *) sleep 0.3; exit 22;; esac`,
        '',
      ].join('\n'),
    )
    await chmod(curl, 0o755)
    const child = Bun.spawn(['sh', '-c', phase], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const exitCode = await child.exited
    return { exitCode, stderr: await new Response(child.stderr).text(), pidFile }
  }

  it('reports the curl failure, not a checksum mismatch, when the binary download fails', async () => {
    const { exitCode, stderr } = await runDownloadPhase()
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('download failed')
    expect(stderr).not.toContain('mismatch')
  })

  it('stops the checksum download when the binary download fails', async () => {
    const { pidFile } = await runDownloadPhase()
    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    const isAlive = (): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    expect(isAlive()).toBe(false)
  })
})
