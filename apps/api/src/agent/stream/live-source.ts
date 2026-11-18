export type LiveSource = {
  subscribe(sessionId: string): Promise<void>
  unsubscribe(sessionId: string): Promise<void>
  readBuffer(sessionId: string): Promise<string | null>
  readShellBacklog(sessionId: string): Promise<string[]>
  onFrame(listener: (args: { sessionId: string; raw: string }) => void): () => void
  onGap(listener: () => void): () => void
  close(): Promise<void>
}
