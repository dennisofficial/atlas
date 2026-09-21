import type { FetchContextArchive } from './workspace-spec'

export type ArchiveRetry = {
  attempts?: number | undefined
  intervalMs?: number | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
}

export const DEFAULT_ARCHIVE_RETRY_ATTEMPTS = 30

export const DEFAULT_ARCHIVE_RETRY_INTERVAL_MS = 3_000

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The lift issues the PUT only after `waitForSandbox` already reports the sandbox running, and a
 * wake's re-upload can land later still since attach's claim chain finishes in the background —
 * so the first GET this boot makes can race a PUT that is still in flight. Taking that first 404
 * as "nothing was ever sent" would boot with no skills, no ATLAS.md, no memory, and log it as a
 * benign fallback. A 404 is therefore retried on a bounded schedule before the caller is told to
 * fall back to the legacy `contextBundle` field; a thrown transport error is not a race and is
 * never retried here.
 */
export async function fetchArchiveWithRetry(args: {
  fetchArchive: FetchContextArchive
  retry?: ArchiveRetry | undefined
}): Promise<Uint8Array | null> {
  const attempts = args.retry?.attempts ?? DEFAULT_ARCHIVE_RETRY_ATTEMPTS
  const intervalMs = args.retry?.intervalMs ?? DEFAULT_ARCHIVE_RETRY_INTERVAL_MS
  const sleep = args.retry?.sleep ?? defaultSleep

  for (let attempt = 1; ; attempt += 1) {
    const archive = await args.fetchArchive()
    if (archive !== null) return archive
    if (attempt >= attempts) return null
    await sleep(intervalMs)
  }
}
