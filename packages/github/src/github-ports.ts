import type { Redis } from 'ioredis'

export type GithubSecretCipher = {
  encrypt(plain: string): string
  decrypt(blob: string): string
}

export type GithubRedis = {
  isConfigured(): boolean
  client(): Redis
  duplicate(): Redis
}

export type GithubDrain = {
  onDrain(handler: () => void): void
}
