export type InProcessLink = {
  sendToServer(text: string): void
  sendToClient(text: string): void
  closeFromClient(): void
  closeFromServer(code?: number, reason?: string): void
}

export const wireInProcessDuplex = (args: {
  onClientText(text: string): void
  onServerText(text: string): void
  onClientClosed?(): void
  onServerClosed?(code?: number, reason?: string): void
}): InProcessLink => {
  let open = true
  return {
    sendToServer(text) {
      if (!open) return
      queueMicrotask(() => args.onServerText(text))
    },
    sendToClient(text) {
      if (!open) return
      queueMicrotask(() => args.onClientText(text))
    },
    closeFromClient() {
      if (!open) return
      open = false
      queueMicrotask(() => args.onClientClosed?.())
    },
    closeFromServer(code, reason) {
      if (!open) return
      open = false
      queueMicrotask(() => args.onServerClosed?.(code, reason))
    },
  }
}
