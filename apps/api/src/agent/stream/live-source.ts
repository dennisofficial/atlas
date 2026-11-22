export type LiveSource = {
  subscribe(key: string): Promise<void>
  unsubscribe(key: string): Promise<void>
  readBuffer(key: string): Promise<string | null>
  readShellBacklog(key: string): Promise<string[]>
  onFrame(listener: (args: { key: string; raw: string }) => void): () => void
  onGap(listener: () => void): () => void
  close(): Promise<void>
}
