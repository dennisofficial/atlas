import type { Event } from '@dltech/atlas-core'

export type SummaryArgs = {
  events: readonly Event[]
  fromSeq: number
  throughSeq: number
}

export type SummariseWith = (
  args: SummaryArgs & { signal?: AbortSignal | undefined },
) => Promise<string | null>

export async function awaitSummary({
  summarise,
  args,
  signal,
}: {
  summarise: SummariseWith
  args: SummaryArgs
  signal?: AbortSignal | undefined
}): Promise<string | null> {
  if (signal === undefined) return summarise(args)
  signal.throwIfAborted()

  return new Promise<string | null>((resolve, reject) => {
    const handleAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', handleAbort, { once: true })

    const settled = (): void => signal.removeEventListener('abort', handleAbort)

    new Promise<string | null>((begin) => begin(summarise({ ...args, signal }))).then(
      (summary) => {
        settled()
        resolve(summary)
      },
      (fault: unknown) => {
        settled()
        reject(fault)
      },
    )
  })
}
