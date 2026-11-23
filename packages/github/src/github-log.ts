export type GithubLogger = {
  log(message: string): void
  warn(message: string): void
  error(message: unknown): void
}

export type GithubLogSink = (context: string) => GithubLogger

const detailOf = (message: unknown): string =>
  message instanceof Error ? (message.stack ?? message.message) : String(message)

const consoleSink: GithubLogSink = (context) => ({
  log: (message) => console.log(`[${context}] ${message}`),
  warn: (message) => console.warn(`[${context}] ${message}`),
  error: (message) => console.error(`[${context}] ${detailOf(message)}`),
})

let sink: GithubLogSink = consoleSink

export function setGithubLogSink(next: GithubLogSink): void {
  sink = next
}

export function resetGithubLogSink(): void {
  sink = consoleSink
}

export function githubLogOf(context: string): GithubLogger {
  return {
    log: (message) => sink(context).log(message),
    warn: (message) => sink(context).warn(message),
    error: (message) => sink(context).error(message),
  }
}
