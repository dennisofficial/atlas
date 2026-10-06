import { createHash } from 'node:crypto'

export const sha256Hex = ({ text }: { text: string }): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')
