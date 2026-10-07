import { appendFileSync } from 'node:fs'

export type BenchmarkEntry = { phase: string; [key: string]: unknown }
export type BenchmarkRecorder = (entry: BenchmarkEntry) => void

export const fileRecorder = (path: string): BenchmarkRecorder => {
  const started = performance.now()
  return (entry) =>
    appendFileSync(path, `${JSON.stringify({ atMs: performance.now() - started, ...entry })}\n`, {
      mode: 0o600,
    })
}

export const measured = async <T>(args: {
  name: string
  record: BenchmarkRecorder
  run: () => Promise<T>
}): Promise<T> => {
  const startedMs = performance.now()
  args.record({ phase: 'span-start', name: args.name, startedMs })
  let ok = false
  try {
    const result = await args.run()
    ok = true
    return result
  } finally {
    args.record({
      phase: 'span',
      name: args.name,
      startedMs,
      elapsedMs: performance.now() - startedMs,
      ok,
    })
  }
}
