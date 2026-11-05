export type StreamPrincipal = { userId: string; expiresAt: number }

export type StreamAuthPort = {
  resolve(bearer: string): Promise<StreamPrincipal | undefined>
}
