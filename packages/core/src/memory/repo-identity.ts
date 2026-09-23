const SCP_LIKE = /^[^/@\s]+@([^/\s:]+):(.+)$/

const GIT_SUFFIX = '.git'

const joinIdentity = (args: { host: string; path: string }): string | null => {
  const host = args.host.toLowerCase()
  const path = args.path.replace(/\/+$/, '').replace(/\.git$/, '').replace(/^\/+/, '')
  if (host === '' || path === '') return null
  return `${host}/${path}`
}

/**
 * The stable identity of a repository regardless of which checkout, worktree or sandbox looks at
 * it: `github.com/org/repo` for every spelling of that remote (`git@github.com:org/repo.git`,
 * `https://github.com/org/repo/`, token-carrying URLs). Returns null for remotes that name no
 * host — a local-path remote identifies no shared project, so the caller keeps keying by path.
 */
export function normalizeRepoOrigin(originUrl: string): string | null {
  const trimmed = originUrl.trim()
  if (trimmed === '') return null

  if (!trimmed.includes('://')) {
    const scp = SCP_LIKE.exec(trimmed)
    if (scp === null) return null
    return joinIdentity({ host: scp[1] ?? '', path: scp[2] ?? '' })
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.host === '') return null

  const path = parsed.pathname.endsWith(GIT_SUFFIX)
    ? parsed.pathname.slice(0, -GIT_SUFFIX.length)
    : parsed.pathname
  return joinIdentity({ host: parsed.host, path })
}
