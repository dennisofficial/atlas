export type HostRequest = {
  url: string
  headers: Record<string, string | string[] | undefined>
  userId?: string
}

export type HostReply = {
  status(code: number): HostReply
  setHeader(name: string, value: string): void
  json(body: unknown): void
  send(body?: unknown): void
  end(): void
}

export const headerOf = (request: HostRequest, name: string): string | undefined => {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}
