import type { JsonRpcMessage, MacClientFrame } from '@dltech/atlas-protocol/mac-link'

export type MacMcpChannel = {
  send(message: JsonRpcMessage): void
  close(reason: string): void
  lastUsedAt(): number
}

export type MacMcpChannelArgs = {
  channelId: string
  emit: (frame: MacClientFrame) => void
  now: () => number
  log: (line: string) => void
}

export const errnoReason = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error)
  const code = 'code' in error ? error.code : undefined
  return code === undefined ? error.message : `${String(code)}: ${error.message}`
}

export const withStderrTail = (reason: string, tail: readonly string[]): string =>
  tail.length === 0 ? reason : `${reason}: ${tail.join(' | ')}`
