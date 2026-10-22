import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { DevServeBinary } from '@dltech/atlas-wire'

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..', '..')

const linuxTargetOfHost = (): string => {
  if (process.arch === 'arm64') return 'bun-linux-arm64'
  if (process.arch === 'x64') return 'bun-linux-x64'
  throw new Error(`no atlas-serve build target for the ${process.arch} architecture`)
}

export const buildDevServe = async (args: { directory: string }): Promise<DevServeBinary> => {
  await mkdir(args.directory, { recursive: true })
  const outfile = join(args.directory, 'atlas-serve')
  const build = Bun.spawn(
    [
      'bun',
      join(REPOSITORY_ROOT, 'apps', 'serve', 'scripts', 'build-serve.ts'),
      '--target',
      linuxTargetOfHost(),
      '--outfile',
      outfile,
    ],
    { cwd: REPOSITORY_ROOT, stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ])
  if (exitCode !== 0) throw new Error(`build-serve exited ${exitCode}\n${stdout}\n${stderr}`)

  const sha256 = createHash('sha256')
    .update(await readFile(outfile))
    .digest('hex')
  return {
    version: `dev-${sha256.slice(0, 12)}`,
    path: outfile,
    sha256,
    bytes: (await stat(outfile)).size,
  }
}
