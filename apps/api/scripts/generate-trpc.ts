import { chmodSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const NATIVE_TARGETS: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
}

const API_ROOT = join(import.meta.dirname, '..')
const DEFAULT_OUTPUT = join(API_ROOT, '..', '..', 'packages', 'api-router', 'src', 'generated')

export function nativeBinaryPath(): string {
  const target = NATIVE_TARGETS[`${process.platform}-${process.arch}`]
  if (target === undefined)
    throw new Error(`no nestjs-trpc binary for ${process.platform}-${process.arch}`)
  const manifest = createRequire(join(API_ROOT, 'package.json')).resolve('nestjs-trpc/package.json')
  return join(dirname(manifest), 'native', target, 'nestjs-trpc')
}

export function generateArgs({ command, output }: { command: string; output: string }): string[] {
  return [command, '-e', 'src/api/app.module.ts', '-o', output, '--import-extension', 'none']
}

if (import.meta.main) {
  const binary = nativeBinaryPath()
  // https://github.com/KevinEdry/nestjs-trpc/issues/124 — the published macOS binaries lack the executable bit
  chmodSync(binary, 0o755)
  const command = process.argv.includes('--watch') ? 'watch' : 'generate'
  const run = Bun.spawnSync([binary, ...generateArgs({ command, output: DEFAULT_OUTPUT })], {
    cwd: API_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(run.exitCode)
}
