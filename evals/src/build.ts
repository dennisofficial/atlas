import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sha256Hex } from './hash'

const evalsDirectory = dirname(dirname(fileURLToPath(import.meta.url)))

export const BUILD_TARGETS = [
  { source: 'src/supervisor.ts', out: 'dist/supervisor.mjs' },
  { source: 'src/child.ts', out: 'dist/child.mjs' },
  { source: 'code-quality/entry.eval.ts', out: 'dist/entry.eval.mjs' },
] as const

export type BuiltArtifact = { target: string; outPath: string; digest: string }

async function buildTarget({ source, out }: { source: string; out: string }): Promise<BuiltArtifact> {
  const outPath = join(evalsRoot(), out)
  await mkdir(dirname(outPath), { recursive: true })
  const result = await Bun.build({
    entrypoints: [join(evalsRoot(), source)],
    target: 'node',
    format: 'esm',
    external: ['evalite', 'evalite/*', 'vitest', 'vitest/*', 'vite', 'better-sqlite3'],
    outfile: outPath,
  })
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('; ')
    throw new Error(`build of ${source} failed: ${messages}`)
  }
  const digest = sha256Hex({ text: await Bun.file(outPath).text() })
  return { target: source, outPath, digest }
}

function evalsRoot(): string {
  return evalsDirectory
}

export async function buildAll(): Promise<readonly BuiltArtifact[]> {
  const artifacts: BuiltArtifact[] = []
  for (const target of BUILD_TARGETS) {
    artifacts.push(await buildTarget({ source: target.source, out: target.out }))
  }
  return artifacts
}

async function handleBuildCli(): Promise<void> {
  const checkOnly = process.argv.includes('--check')
  const missing: string[] = []
  for (const target of BUILD_TARGETS) {
    const sourcePath = join(evalsRoot(), target.source)
    if (!(await Bun.file(sourcePath).exists())) missing.push(target.source)
  }
  if (missing.length > 0) {
    throw new Error(`build sources missing: ${missing.join(', ')}`)
  }
  if (checkOnly) {
    console.log(`build check ok: ${BUILD_TARGETS.length} targets present`)
    return
  }
  const artifacts = await buildAll()
  for (const artifact of artifacts) console.log(`${artifact.out} ${artifact.digest}`)
}

if (import.meta.main) {
  await handleBuildCli()
}
