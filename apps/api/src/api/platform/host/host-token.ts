import { createHash, timingSafeEqual } from 'node:crypto'

const digestOf = (token: string): Buffer => createHash('sha256').update(token).digest()

export const constantTimeEquals = (args: { offered: string; expected: string }): boolean =>
  timingSafeEqual(digestOf(args.offered), digestOf(args.expected))
