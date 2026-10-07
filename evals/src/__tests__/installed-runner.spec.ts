import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EQualityImpact } from '@dltech/atlas-core'

import { makeTmpDir } from '../../__fixtures__/curation'
import { runGoldenPipeline } from '../../__fixtures__/golden-pipeline'
import { writeJsonAtomic } from '../atomic'

const evalsRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const created: string[] = []

const cli = async ({ args }: { args: readonly string[] }) => {
  const child = Bun.spawn(['bun', 'run', join(evalsRoot, 'src/cli.ts'), ...args], {
    cwd: evalsRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, code }
}

const onlyRunDirectory = async ({ parent }: { parent: string }): Promise<string> => {
  const [name] = await readdir(parent)
  if (name === undefined) throw new Error('no run directory written')
  return join(parent, name)
}

beforeAll(async () => {
  const build = Bun.spawn(['bun', 'run', join(evalsRoot, 'src/build.ts')], { cwd: evalsRoot, stdout: 'ignore', stderr: 'pipe' })
  if ((await build.exited) !== 0) throw new Error(await new Response(build.stderr).text())
}, 60_000)

afterAll(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('installed runner (compiled children, Node child process, no network)', () => {
  test('the documented default smoke command materializes its synthetic dataset and completes', async () => {
    const parent = await makeTmpDir()
    created.push(parent)
    const { code, stderr } = await cli({ args: ['run', '--suite', 'smoke', '--fake', '--trials', '2', '--output-parent', parent] })
    expect(stderr).not.toContain('not readable')
    expect(code).toBe(0)
    const directory = await onlyRunDirectory({ parent })
    const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
    expect(summary.status).toBe('complete')
    expect(summary.mode).toBe('fake')
    expect(summary.promotable).toBe(false)
    expect(summary.datasetVersion).toBe('1-smoke')
    expect(summary.planned.rows).toBe(8)
    expect(summary.completed).toBe(8)
  }, 90_000)

  test('real policy + curated golden case run through the compiled child and real Jev client, with strict model parity', async () => {
    const sessionDir = await makeTmpDir()
    const work = await makeTmpDir()
    const parent = await makeTmpDir()
    created.push(sessionDir, work, parent)
    const golden = await runGoldenPipeline({ sessionDir, work })
    const answers = {
      [`${golden.candidateId}::trial-1::default`]: {
        'single-responsibility:currentConcern': { noul: 0.9 },
        'single-responsibility:impact': { choice: EQualityImpact.Introduced, probabilities: { [EQualityImpact.Introduced]: 0.9 } },
        'single-responsibility:focus': { choice: golden.evidenceId, probabilities: { [golden.evidenceId]: 0.9 } },
      },
    }
    const answersPath = join(work, 'answers.json')
    await writeJsonAtomic({ path: answersPath, value: answers })

    const matching = await cli({
      args: ['run', '--suite', 'code-quality/single-responsibility', '--fake', '--dataset', golden.goldenManifest, '--answers', answersPath, '--output-parent', parent],
    })
    expect(matching.code).toBe(0)
    const directory = await onlyRunDirectory({ parent })
    const manifest = JSON.parse(await readFile(join(directory, 'invocation.manifest.json'), 'utf8'))
    expect(manifest.enabledPolicyIds).toEqual(['single-responsibility'])
    const summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))
    expect(summary.model.resolved).toBe(summary.model.requested)
    expect(summary.enabledPolicyIds).toEqual(['single-responsibility'])
    expect(summary.promotable).toBe(false)
  }, 90_000)

  test('a non-default requested model is recorded and never promotable', async () => {
    const parent = await makeTmpDir()
    created.push(parent)
    const { code } = await cli({ args: ['run', '--suite', 'smoke', '--fake', '--model', 'other-model', '--output-parent', parent] })
    expect(code).toBe(0)
    const summary = JSON.parse(await readFile(join(await onlyRunDirectory({ parent }), 'summary.json'), 'utf8'))
    expect(summary.promotable).toBe(false)
    expect(summary.model.requested).toBe('other-model')
  }, 90_000)
})
