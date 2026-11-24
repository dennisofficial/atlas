import { parseArgs, startSeqOf, type BenchOptions } from './cli'
import { runCatchUp } from './client'
import { profilesNamed } from './profiles'
import { createShapingProxy } from './proxy'
import { renderTable, writeResults, type BenchRow } from './report'
import { createBenchServer } from './server'
import { BENCH_SESSION, BENCH_USER, createBenchWorld } from './world'

const SETTLE_MS = 250

const rowOf = (args: {
  size: number
  profile: string
  start: string
  outcome: Awaited<ReturnType<typeof runCatchUp>>
  bytesDown: number
  stalls: number
  counts: { readEvents: number; head: number; readSessionView: number }
}): BenchRow => ({
  size: args.size,
  profile: args.profile,
  start: args.start,
  firstEventsMs: args.outcome.firstEventsMs,
  liveMs: args.outcome.liveMs,
  timedOut: args.outcome.timedOut,
  bytesDown: args.bytesDown,
  eventsFrames: args.outcome.eventsFrames,
  readEvents: args.counts.readEvents,
  headCalls: args.counts.head,
  readSessionView: args.counts.readSessionView,
  stalls: args.stalls,
  leftOpen: args.outcome.leftOpen,
})

export const runMatrix = async (args: {
  options: BenchOptions
  onRow?: ((row: BenchRow) => void) | undefined
}): Promise<BenchRow[]> => {
  const { options } = args
  const rows: BenchRow[] = []
  for (const size of options.sizes) {
    const world = await createBenchWorld({ events: size, queryDelayMs: options.queryDelayMs })
    const server = createBenchServer({
      stream: world.stream,
      userId: BENCH_USER,
      gzip: options.gzip,
    })
    try {
      for (const profile of profilesNamed(options.profiles)) {
        for (const start of options.starts) {
          const proxy = createShapingProxy({
            profile,
            upstreamPort: server.port,
            seed: options.seed + size + start.length,
          })
          try {
            world.resetCounts()
            const outcome = await runCatchUp({
              url: proxy.url,
              sessionId: BENCH_SESSION,
              startSeq: startSeqOf({ start, head: size }),
              timeoutMs: options.timeoutMs,
            })
            await Bun.sleep(SETTLE_MS)
            const row = rowOf({
              size,
              profile: profile.name,
              start,
              outcome,
              bytesDown: proxy.stats.bytesDown,
              stalls: proxy.stats.stalls,
              counts: world.counts,
            })
            rows.push(row)
            args.onRow?.(row)
          } finally {
            proxy.close()
          }
        }
      }
    } finally {
      await server.close()
      world.close()
    }
  }
  return rows
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2))
  const rows = await runMatrix({
    options,
    onRow: (row) =>
      console.error(
        `${row.size} ${row.profile} ${row.start}: ${row.timedOut ? 'timeout' : `${Math.round(row.liveMs ?? 0)}ms`} live, ${Math.round(row.bytesDown / 1024)}KB`,
      ),
  })
  console.log(renderTable(rows))
  if (options.json)
    console.error(`results written to ${await writeResults({ rows, options, now: new Date() })}`)
}
