const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const INSECURE_SSL_MODES = new Set(['disable', 'allow', 'prefer'])

export class InsecureDatabaseUrlError extends Error {
  constructor(args: { host: string; sslmode: string }) {
    super(
      `refusing sslmode=${args.sslmode} for remote host ${args.host}: remote postgres requires sslmode=require or stronger`,
    )
    this.name = 'InsecureDatabaseUrlError'
  }
}

export const databaseUrlWithTls = (url: string): string => {
  const parsed = new URL(url)
  if (LOCAL_HOSTS.has(parsed.hostname)) return url
  const sslmode = parsed.searchParams.get('sslmode')
  if (sslmode !== null && INSECURE_SSL_MODES.has(sslmode)) {
    throw new InsecureDatabaseUrlError({ host: parsed.hostname, sslmode })
  }
  if (sslmode === null) parsed.searchParams.set('sslmode', 'require')
  return parsed.toString()
}
