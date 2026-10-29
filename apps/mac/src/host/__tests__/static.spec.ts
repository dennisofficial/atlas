import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopHost, type IDesktopHost } from '../index'

let root: string
let host: IDesktopHost

async function put(path: string, body: string): Promise<void> {
  const full = join(root, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, body)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-mac-web-'))
  await put('index.html', 'home')
  await put('404.html', 'missing')
  await put('settings.html', 'settings')
  await put('projects/index.html', 'projects')
  await put('threads/_.html', 'thread-shell')
  await put('projects/_/settings.html', 'project-settings')
  await put('projects/_/settings/mcp.html', 'project-settings-mcp')
  await put('_next/static/app.js', 'console.log(1)')
  await writeFile(join(root, '..', 'atlas-mac-secret.txt'), 'secret')
  host = createDesktopHost({ webRoot: root, apiOrigin: 'http://127.0.0.1:1', secret: 's' })
})

afterAll(async () => {
  await host.stop()
  await rm(root, { recursive: true, force: true })
})

const get = (path: string) => fetch(`${host.url}${path}`)

describe('static resolution', () => {
  test('serves index, <path>.html and <path>/index.html', async () => {
    expect(await (await get('/')).text()).toBe('home')
    expect(await (await get('/settings')).text()).toBe('settings')
    expect(await (await get('/projects')).text()).toBe('projects')
  })

  test('html is no-cache, next static is immutable', async () => {
    expect((await get('/settings')).headers.get('cache-control')).toBe('no-cache')
    const asset = await get('/_next/static/app.js')
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect(asset.headers.get('content-type')).toContain('text/javascript')
  })

  test('dynamic routes fall back to the placeholder page', async () => {
    expect(await (await get('/threads/abc123')).text()).toBe('thread-shell')
    expect(await (await get('/projects/p1/settings')).text()).toBe('project-settings')
    expect(await (await get('/projects/p1/settings/mcp')).text()).toBe('project-settings-mcp')
    expect((await get('/projects/p1/settings/bogus')).status).toBe(404)
  })

  test('unknown paths return 404.html with status 404', async () => {
    const res = await get('/nope')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('missing')
  })

  test('rejects path traversal', async () => {
    for (const path of [
      '/../atlas-mac-secret.txt',
      '/%2e%2e/atlas-mac-secret.txt',
      '/..%2fatlas-mac-secret.txt',
    ]) {
      const res = await get(path)
      expect(await res.text()).not.toBe('secret')
    }
    const raw = await new Promise<string>((resolve) => {
      const chunks: string[] = []
      void Bun.connect({
        hostname: '127.0.0.1',
        port: host.port,
        socket: {
          open(socket) {
            socket.write(
              'GET /../atlas-mac-secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
            )
          },
          data(_socket, data) {
            chunks.push(data.toString())
          },
          close() {
            resolve(chunks.join(''))
          },
        },
      })
    })
    expect(raw).not.toContain('secret\n')
    expect(raw.endsWith('secret')).toBe(false)
  })
})
