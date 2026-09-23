export const gitConfigEnv = (args: {
  worktree: string
  githubToken?: string | undefined
}): string[] => {
  // Scoped safe.directory wildcards require recent Git; Debian Bookworm's Git 2.39 ignores them.
  // https://github.com/git/git/blob/v2.46.0/Documentation/config/safe.txt
  const gitConfig: Array<readonly [key: string, value: string]> = [
    ['gpg.program', 'gpg'],
    ['safe.directory', args.worktree],
    ['safe.directory', `${args.worktree.replace(/\/$/, '')}/*`],
  ]
  if (args.githubToken !== undefined) {
    // SSH pushes authenticate through the forwarded agent, which may hold no identities; the gh
    // token is the one credential the sandbox provably has, so github traffic goes over https.
    // The empty helper resets the list the mounted host gitconfig names (osxkeychain is absent
    // in the image). https://git-scm.com/docs/git-config#Documentation/git-config.txt-credentialhelper
    gitConfig.push(
      ['credential.helper', ''],
      ['credential.https://github.com.helper', '!gh auth git-credential'],
      ['url.https://github.com/.insteadOf', 'git@github.com:'],
      ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
    )
  }
  return [
    `GIT_CONFIG_COUNT=${gitConfig.length}`,
    ...gitConfig.flatMap(([key, value], index) => [
      `GIT_CONFIG_KEY_${index}=${key}`,
      `GIT_CONFIG_VALUE_${index}=${value}`,
    ]),
  ]
}
