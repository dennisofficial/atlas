import { EventEmitter } from 'node:events'

import { describe, expect, test } from 'bun:test'

import { parseSessionUrl, startDesktopHost } from '../host-process'

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = null
  child.kill = (signal) => {
    child.killed = signal
  }
  return child
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('desktop host session url', () => {
  test('reads the url the host prints', () => {
    const output = 'booting\nATLAS_URL=http://127.0.0.1:51234/desktop/session?secret=abc\n'
    expect(parseSessionUrl(output)).toBe('http://127.0.0.1:51234/desktop/session?secret=abc')
  })

  test('is null before the host prints a url', () => {
    expect(parseSessionUrl('next server on http://127.0.0.1:3000\n')).toBeNull()
  })
})

describe('startDesktopHost', () => {
  test('resolves with the url and passes the pane origin', async () => {
    const child = fakeChild()
    let invocation = null
    const started = startDesktopHost({
      script: '/repo/apps/mac/src/desktop-host/index.ts',
      cwd: '/repo',
      paneOrigin: 'http://127.0.0.1:4100',
      env: { PATH: '/bin', ATLAS_BUN: '/opt/bun' },
      spawnProcess: (options) => {
        invocation = options
        return child
      },
    })

    child.stdout.emit('data', 'ATLAS_URL=http://127.0.0.1:9/desktop/session?secret=s\n')
    const host = await started

    expect(host.url).toBe('http://127.0.0.1:9/desktop/session?secret=s')
    expect(invocation.command).toBe('/opt/bun')
    expect(invocation.args).toEqual(['/repo/apps/mac/src/desktop-host/index.ts'])
    expect(invocation.cwd).toBe('/repo')
    expect(invocation.env.ATLAS_PANE_ORIGIN).toBe('http://127.0.0.1:4100')
    expect(invocation.env.PATH).toBe('/bin')
  })

  test('stops the host on request', async () => {
    const child = fakeChild()
    const started = startDesktopHost({
      script: 'index.ts',
      cwd: '/repo',
      paneOrigin: 'http://127.0.0.1:4100',
      env: {},
      spawnProcess: () => child,
    })
    child.stdout.emit('data', 'ATLAS_URL=http://127.0.0.1:9/desktop/session?secret=s\n')
    const host = await started
    host.stop()
    expect(child.killed).toBe('SIGTERM')
  })

  test('rejects when the host exits before printing a url', async () => {
    const child = fakeChild()
    const started = startDesktopHost({
      script: 'index.ts',
      cwd: '/repo',
      paneOrigin: 'http://127.0.0.1:4100',
      env: {},
      spawnProcess: () => child,
    })
    child.stderr.emit('data', 'no bun found\n')
    child.emit('exit', 1)
    await expect(started).rejects.toThrow(/exited with code 1 before it was ready/)
  })

  test('rejects and stops the host when the url never arrives', async () => {
    const child = fakeChild()
    const started = startDesktopHost({
      script: 'index.ts',
      cwd: '/repo',
      paneOrigin: 'http://127.0.0.1:4100',
      env: {},
      timeoutMs: 10,
      spawnProcess: () => child,
    })
    await expect(started).rejects.toThrow(/did not print ATLAS_URL=/)
    await flush()
    expect(child.killed).toBe('SIGTERM')
  })
})
