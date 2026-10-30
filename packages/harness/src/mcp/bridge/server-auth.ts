import type { McpAuthProvider } from '../transport'
import type { McpTokenSource } from './token-source'

export class ServerAuth implements McpAuthProvider {
  private challenge: string | undefined
  private lastToken: string | undefined

  constructor(private readonly args: { serverUrl: string; source: McpTokenSource }) {}

  async bearerToken(): Promise<string | undefined> {
    const token = await this.args.source.currentToken({ serverUrl: this.args.serverUrl })
    this.lastToken = token
    return token
  }

  onUnauthorized(args: { wwwAuthenticate: string | undefined }): void {
    this.challenge = args.wwwAuthenticate
    if (this.lastToken === undefined) return
    this.args.source.reject({ serverUrl: this.args.serverUrl, token: this.lastToken })
  }

  lastChallenge(): string | undefined {
    return this.challenge
  }
}
