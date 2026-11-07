import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export type GitIdentity = { name: string; email: string }

export type IdentityLookup = (args: { token: string; signal: AbortSignal }) => Promise<GitIdentity>

const CREDENTIAL_HELPER = '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'

const withoutTrailingSlash = (path: string): string => path.replace(/\/$/, '')

export type SigningConfig = {
  keyPath: string
  allowedSignersPath: string
  userName: string
  userEmail: string
}

type GitConfigEntry = readonly [key: string, value: string]

const hasToken = (token: string | null): token is string => token !== null && token !== ''

const tokenEntries: GitConfigEntry[] = [
  ['credential.helper', ''],
  ['credential.https://github.com.helper', CREDENTIAL_HELPER],
  ['url.https://github.com/.insteadOf', 'git@github.com:'],
  ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
]

const identityEntries = (args: {
  identity: GitIdentity | null
  signing: SigningConfig | null
}): GitConfigEntry[] => {
  if (args.signing !== null) {
    return [
      ['user.name', args.signing.userName],
      ['user.email', args.signing.userEmail],
    ]
  }
  if (args.identity === null) return []
  return [
    ['user.name', args.identity.name],
    ['user.email', args.identity.email],
  ]
}

const signingEntries = (signing: SigningConfig | null): GitConfigEntry[] =>
  signing === null
    ? []
    : [
        ['gpg.format', 'ssh'],
        ['user.signingkey', signing.keyPath],
        ['commit.gpgsign', 'true'],
        ['tag.gpgsign', 'true'],
        ['gpg.ssh.allowedSignersFile', signing.allowedSignersPath],
      ]

export const shellEnvOf = (args: {
  githubToken: string | null
  identity: GitIdentity | null
  signing: SigningConfig | null
  launchDirectory: string
}): Record<string, string> => {
  const { githubToken, identity, signing } = args
  if (!hasToken(githubToken) && signing === null) return {}
  const worktree = withoutTrailingSlash(args.launchDirectory)
  const config: GitConfigEntry[] = [
    ['safe.directory', worktree],
    ['safe.directory', `${worktree}/*`],
    ...(hasToken(githubToken) ? tokenEntries : []),
    ...identityEntries({ identity, signing }),
    ...signingEntries(signing),
  ]
  return {
    ...(hasToken(githubToken) ? { GH_TOKEN: githubToken } : {}),
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(
      config.flatMap(([key, value], index) => [
        [`GIT_CONFIG_KEY_${index}`, key],
        [`GIT_CONFIG_VALUE_${index}`, value],
      ]),
    ),
  }
}

export class ShellEnvCell {
  private env: Record<string, string> = {}

  constructor(
    private readonly args: {
      identityOf: IdentityLookup
      log?: LogPort | undefined
    },
  ) {}

  current(): Record<string, string> {
    return this.env
  }

  async refresh(args: {
    token: string | null
    signing: SigningConfig | null
    launchDirectory: string
    signal: AbortSignal
  }): Promise<void> {
    const { token, signing, launchDirectory, signal } = args
    this.env = shellEnvOf({ githubToken: token, identity: null, signing, launchDirectory })
    if (!hasToken(token) || signing !== null) return
    try {
      const identity = await this.args.identityOf({ token, signal })
      this.env = shellEnvOf({ githubToken: token, identity, signing, launchDirectory })
    } catch (error) {
      this.args.log?.error({
        source: 'runtime.shell-env',
        message: 'github identity lookup failed; shells get the token but no git identity',
        ...logFieldsOf({ error }),
      })
    }
  }
}
