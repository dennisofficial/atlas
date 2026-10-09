import { join } from 'node:path'
import type { Sandbox } from '@vercel/sandbox'

import type { DockerEngine } from '../engine'
import { runSandboxScript } from '../sandbox-scripts'
import { quoted } from './live-docker'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..')
const RELEASE_URL = /https:\/\/github\.com\/dennisofficial\/atlas\/releases\/download\/tui-v[^/"\s]+/g

export const OLD_SERVE_STUB = `#!/usr/bin/python3
import http.server, os

class Health(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/v1/health' else 404)
        self.end_headers()
        self.wfile.write(b'{"ok":true,"stub":"old-serve"}')

    def log_message(self, *args):
        pass

http.server.HTTPServer(('127.0.0.1', int(os.environ['ATLAS_SERVE_PORT'])), Health).serve_forever()
`

export const buildServeBinary = async (outfile: string): Promise<void> => {
  const build = Bun.spawn(
    ['bun', 'run', 'build:serve', '--', '--target', 'bun-linux-x64', '--outfile', outfile],
    { cwd: join(REPO_ROOT, 'apps', 'serve'), stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ])
  if (exitCode !== 0) throw new Error(`building atlas-serve exited ${exitCode}\n${stdout}\n${stderr}`)
}

export type DownloadSource = { base: string }

export const dockerSandbox = (args: {
  engine: DockerEngine
  containerId: string
  source: DownloadSource
}): Sandbox => {
  const { engine, containerId, source } = args
  const sandbox = {
    name: 'hot-swap-container',
    runCommand: async (params: {
      args?: string[]
      env?: Record<string, string>
      detached?: boolean
    }) => {
      const script = (params.args?.[1] ?? '').replaceAll(RELEASE_URL, () => source.base)
      if (params.detached === true) {
        const exec = await engine.createExec({
          containerId,
          cmd: ['sh', '-c', script],
          cwd: '/',
          env: params.env ?? {},
        })
        await engine.startExec({ execId: exec.id, detach: true })
        return { cmdId: exec.id }
      }
      const exports = Object.entries(params.env ?? {})
        .map(([key, value]) => `export ${key}=${quoted(value)};`)
        .join(' ')
      const outcome = await runSandboxScript({
        engine,
        containerId,
        cwd: '/',
        script: `${exports} ${script}`,
      })
      return {
        exitCode: outcome.exitCode,
        stdout: async () => outcome.output,
        stderr: async () => outcome.output,
      }
    },
    writeFiles: async (files: { path: string; content: string | Uint8Array; mode?: number }[]) => {
      for (const file of files) {
        const text = typeof file.content === 'string' ? file.content : Buffer.from(file.content).toString()
        const mode = (file.mode ?? 0o644).toString(8)
        const outcome = await runSandboxScript({
          engine,
          containerId,
          cwd: '/',
          script: `printf '%s' ${quoted(text)} > ${quoted(file.path)} && chmod ${mode} ${quoted(file.path)}`,
        })
        if (outcome.exitCode !== 0) throw new Error(`writeFiles failed: ${outcome.output}`)
      }
    },
  }
  return sandbox as unknown as Sandbox
}

export const serveRelease = (args: { bytes: Uint8Array; sha256: string }): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    hostname: '0.0.0.0',
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url)
      if (pathname === '/release/atlas-serve-linux-x64' || pathname === '/corrupt/atlas-serve-linux-x64') {
        return new Response(args.bytes)
      }
      if (pathname === '/release/atlas-serve-linux-x64.sha256') {
        return new Response(`${args.sha256}  atlas-serve-linux-x64\n`)
      }
      if (pathname === '/corrupt/atlas-serve-linux-x64.sha256') {
        return new Response(`${'0'.repeat(64)}  atlas-serve-linux-x64\n`)
      }
      return new Response('not found', { status: 404 })
    },
  })
