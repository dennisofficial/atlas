import { CloudSessionStore } from '../cloud/cloud-session'
import { atlasCloudFile, atlasVaultKeyFile } from '../credentials/paths'

/** The sandbox's only credential is its session token, so its cloud session file holds exactly
 * that: the session-aware machinery (the cloud-required gate, the transport clients) reads it
 * unchanged. Accounts, secrets and credentials do NOT flow through the session-gated proxies here
 * — the API refuses a sandbox token on those user-facing routes, and serve reaches the
 * thread-scoped broker adapters registered in compose-serve instead. */
export function seedServeSession(args: { url: string; token: string }): void {
  const sessions = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
  sessions.write({ url: args.url, token: args.token, email: null })
}
