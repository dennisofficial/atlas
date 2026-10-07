import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  assertBenchmarkOutput,
  defaultSourceHome,
  makeBenchmarkDirectory,
} from './cloud-bench/environment'
import { summarizeSamples, type SummarySample } from './cloud-bench/summary'
import { runBenchmarkWorker } from './cloud-bench/watchdog'
import type { SampleArgs } from './cloud-bench/worker'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined =>
  argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)

const requireFlag = (name: string): string => {
  const value = flag(name)
  if (value === undefined || value.length === 0) throw new Error(`--${name}=... is required`)
  return value
}

if (process.env.ATLAS_LIVE_CLOUD_BENCH !== '1')
  throw new Error('Set ATLAS_LIVE_CLOUD_BENCH=1 to authorize real Vercel benchmark sandboxes')

const worker = flag('worker')
if (worker !== undefined) {
  const args: SampleArgs = JSON.parse(await readFile(worker, 'utf8'))
  try {
    const { runSample } = await import('./cloud-bench/worker')
    await runSample(args)
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exit(1)
  }
} else {
  const sourceSession = requireFlag('session')
  if (!/^brn_[\w-]+$/.test(sourceSession))
    throw new Error('--session must be a session ID, not a path')
  const runs = Number(flag('runs') ?? '3')
  if (!Number.isInteger(runs) || runs < 1 || runs > 20)
    throw new Error('--runs must be an integer from 1 to 20')
  const scratch = process.env.ATLAS_SESSION_DIR
  if (scratch === undefined && flag('output') === undefined)
    throw new Error('Provide --output=... or ATLAS_SESSION_DIR for benchmark artifacts')
  const sourceHome = resolve(flag('source-home') ?? defaultSourceHome())
  const sourceRepository = resolve(flag('repository') ?? join(import.meta.dir, '../../..'))
  const outputParent = flag('output') ?? join(scratch ?? '', 'scratch')
  await assertBenchmarkOutput({
    output: outputParent,
    protectedRoots: [join(sourceHome, 'sessions', sourceSession), sourceRepository],
  })
  const output = await makeBenchmarkDirectory(outputParent)
  const samples: SummarySample[] = []
  console.log(`Cloud benchmark artifacts: ${output}`)
  for (let sample = 1; sample <= runs; sample += 1) {
    const directory = await makeBenchmarkDirectory(output)
    const args: SampleArgs = {
      sourceHome,
      sourceSession,
      sourceRepository,
      directory,
      image: flag('image'),
    }
    const input = join(directory, 'sample.json')
    await writeFile(input, `${JSON.stringify(args, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    console.log(`Starting cold sample ${sample}/${runs}: ${directory}`)
    await runBenchmarkWorker({
      entry: import.meta.path,
      input,
      cwd: resolve(join(import.meta.dir, '../../..')),
      directory,
      env: { ...process.env, NODE_ENV: 'development' },
    })
    const result: SummarySample = JSON.parse(
      await readFile(join(directory, 'result.json'), 'utf8'),
    )
    samples.push(result)
    console.log(
      `Sample ${sample}: lift ${(result.liftMs / 1000).toFixed(2)}s, descend ${(result.descendMs / 1000).toFixed(2)}s; verification passed`,
    )
  }
  const result = summarizeSamples(samples)
  await writeFile(join(output, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  console.log(
    JSON.stringify({
      phase: 'CLOUD_BENCHMARK_PASSED',
      summary: join(output, 'summary.json'),
      lift: result.lift,
      descend: result.descend,
      comparable: result.comparable,
      runtimeDrift: result.runtimeDrift,
      workspaceDrift: result.workspaceDrift,
    }),
  )
  if (!result.comparable)
    console.warn(
      `Warning: samples are not comparable (runtimeDrift=${result.runtimeDrift}, workspaceDrift=${result.workspaceDrift}); treat timings as observations, not a controlled baseline`,
    )
}
