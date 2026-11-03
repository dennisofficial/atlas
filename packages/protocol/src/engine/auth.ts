import { createHmac, timingSafeEqual } from 'node:crypto'

export const daemonToken = (args: { secret: string; sandboxName: string }): string =>
  createHmac('sha256', args.secret).update(args.sandboxName).digest('hex')

export const daemonTokenMatches = (args: { want: string; token: string }): boolean => {
  const given = Buffer.from(args.token, 'utf8')
  const want = Buffer.from(args.want, 'utf8')
  if (given.length !== want.length) return false
  return timingSafeEqual(given, want)
}
