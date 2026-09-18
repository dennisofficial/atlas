import { CloudSessionStore } from '../cloud/cloud-session'
import { atlasCloudFile, atlasVaultKeyFile } from '../credentials/paths'

/** The sandbox's only credential is its session token, so its cloud session file holds exactly
 * that: the session-gated proxies (accounts, secrets, brokered credentials) then work against the
 * control plane unchanged, with the API trusting the token for the thread it belongs to. */
export function seedServeSession(args: { url: string; token: string }): void {
  const sessions = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
  sessions.write({ url: args.url, token: args.token, email: null })
}
