const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export const databaseUrlWithTls = (url: string): string => {
  const parsed = new URL(url)
  if (LOCAL_HOSTS.has(parsed.hostname)) return url
  if (parsed.searchParams.has('sslmode')) return url
  parsed.searchParams.set('sslmode', 'require')
  return parsed.toString()
}
