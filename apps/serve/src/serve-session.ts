import { CloudSessionStore } from '@dltech/atlas-harness/src/cloud/cloud-session'
import { atlasCloudFile, atlasVaultKeyFile } from '@dltech/atlas-harness/src/credentials/paths'

/** The sandbox's only credential is its session token, so its cloud session file holds exactly
 * that: the session-aware machinery (the cloud-required gate, the transport clients) reads it
 * unchanged. Accounts, secrets and credentials do NOT flow through the session-gated proxies here
 * — the API refuses a sandbox token on those user-facing routes, and serve reaches the
 * thread-scoped broker adapters registered in compose-serve instead. */
export function seedServeSession(args: { url: string; token: string }): void {
  const file = atlasCloudFile()
  const sessions = new CloudSessionStore({ file, keyFile: atlasVaultKeyFile() })

  const humanSignIn = sessions.read()?.email ?? null
  if (humanSignIn !== null)
    throw new Error(
      `Refusing to boot serve over ${file}: it holds the Atlas Cloud sign-in for ${humanSignIn}, ` +
        'and seeding the sandbox session would sign that user out. Run serve with ATLAS_HOME ' +
        'pointed at a scratch directory.',
    )

  sessions.write({ url: args.url, token: args.token, email: null })
}
