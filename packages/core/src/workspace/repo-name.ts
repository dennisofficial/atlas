/**
 * The repository name a git remote URL ends in, without any `.git` suffix — the directory name a
 * clone of that remote lands in. Handles HTTPS, SCP-style SSH (`git@host:owner/repo`), and
 * `ssh://` forms. Anything without a path tail answers `workspace`, matching git's own refusal to
 * guess for those inputs.
 */
export function repoNameOfRemoteUrl(remoteUrl: string): string {
  const ssh = /^(?:ssh:\/\/)?[^/@:]+@([^/:]+)[:/](.+)$/.exec(remoteUrl)
  const raw = ssh === null ? remoteUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '') : (ssh[2] ?? '')
  const tail = raw.replace(/\/+$/, '').split('/').pop() ?? ''
  const name = tail.replace(/\.git$/, '')
  return name === '' ? 'workspace' : name
}
