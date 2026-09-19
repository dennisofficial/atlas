export const EXPOSURE_HOST_SUFFIX = '.sandbox.localhost'

export const EXPOSURE_HOSTNAME = 'sandbox.localhost'

export function exposureUrlFor(args: { containerPort: number; hostPort: number }): string {
  return `http://${args.containerPort}${EXPOSURE_HOST_SUFFIX}:${args.hostPort}`
}

export function exposurePortFromHost(host: string): number | undefined {
  const hostname = host.split(':')[0] ?? ''
  if (!hostname.endsWith(EXPOSURE_HOST_SUFFIX)) return undefined

  const prefix = hostname.slice(0, hostname.length - EXPOSURE_HOST_SUFFIX.length)
  if (!/^\d{1,5}$/.test(prefix)) return undefined

  const port = Number(prefix)
  if (port < 1 || port > 65_535) return undefined
  return port
}

export function exposureInfoPage(args: { hostPort: number }): string {
  return [
    'atlas sandbox port proxy',
    '',
    `open a port in this sandbox as http://<port>${EXPOSURE_HOST_SUFFIX}:${args.hostPort}/`,
    `for example http://3000${EXPOSURE_HOST_SUFFIX}:${args.hostPort}/`,
    '',
  ].join('\n')
}

export const EXPOSURE_REFUSED_LEAD = 'nothing is listening on port '

export const EXPOSURE_REFUSED_TAIL =
  ' in this sandbox\nstart the server first - bound to 0.0.0.0, not 127.0.0.1 - then reload\n'

export function exposureRefusedPage(args: { containerPort: number }): string {
  return `${EXPOSURE_REFUSED_LEAD}${args.containerPort}${EXPOSURE_REFUSED_TAIL}`
}
