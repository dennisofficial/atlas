import { normalizedPrRepo } from './pr-repo'

const URL_FORM = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)[/:](.+)$/i
const SCP_FORM = /^(?:[^@/]+@)([^/:]+):(.+)$/
const BARE_FORM = /^(github\.com)[/:](.+)$/i

const parsedRemoteOf = (remoteUrl: string): { host: string; path: string } | null => {
  const url = URL_FORM.exec(remoteUrl)
  if (url !== null) return { host: url[1] ?? '', path: url[2] ?? '' }
  const scp = SCP_FORM.exec(remoteUrl)
  if (scp !== null) return { host: scp[1] ?? '', path: scp[2] ?? '' }
  const bare = BARE_FORM.exec(remoteUrl)
  if (bare !== null) return { host: bare[1] ?? '', path: bare[2] ?? '' }
  return null
}

export const githubRepoOfRemoteUrl = (remoteUrl: string): string | null => {
  const remote = parsedRemoteOf(remoteUrl.trim())
  if (remote === null) return null
  if (remote.host.toLowerCase() !== 'github.com') return null
  const segments = remote.path
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter((segment) => segment !== '')
  if (segments.length < 2) return null
  return normalizedPrRepo(segments.slice(-2).join('/'))
}
