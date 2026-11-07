import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export type GitIdentity = { name: string; email: string }

export type IdentityLookup = (args: { token: string; signal: AbortSignal }) => Promise<GitIdentity>

const CREDENTIAL_HELPER = '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'

const withoutTrailingSlash = (path: string): string => path.replace(/\/$/, '')

const gitConfigOf = (args: {
  identity: GitIdentity | null
  launchDirectory: string
}): Array<readonly [key: string, value: string]> => {
  const worktree = withoutTrailingSlash(args.launchDirectory)
  return [
    ['safe.directory', worktree],
    ['safe.directory', `${worktree}/*`],
    ['credential.helper', ''],
    ['credential.https://github.com.helper', CREDENTIAL_HELPER],
    ['url.https://github.com/.insteadOf', 'git@github.com:'],
    ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
    ...(args.identity === null
      ? []
      : ([
          ['user.name', args.identity.name],
          ['user.email', args.identity.email],
        ] as const)),
  ]
}

export const shellEnvOf = (args: {
  githubToken: string | null
  identity: GitIdentity | null
  launchDirectory: string
}): Record<string, string> => {
  if (args.githubToken === null || args.githubToken === '') return {}
  const config = gitConfigOf(args)
  return {
    GH_TOKEN: args.githubToken,
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
    launchDirectory: string
    signal: AbortSignal
  }): Promise<void> {
    const { token, launchDirectory, signal } = args
    this.env = shellEnvOf({ githubToken: token, identity: null, launchDirectory })
    if (token === null || token === '') return
    try {
      const identity = await this.args.identityOf({ token, signal })
      this.env = shellEnvOf({ githubToken: token, identity, launchDirectory })
    } catch (error) {
      this.args.log?.error({
        source: 'runtime.shell-env',
        message: 'github identity lookup failed; shells get the token but no git identity',
        ...logFieldsOf({ error }),
      })
    }
  }
}
