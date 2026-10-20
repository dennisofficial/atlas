import { randomUUID } from 'node:crypto'

export const uniqueTestPrefix = (suite: string): string =>
  `atlas-dev-${suite}-${process.pid}-${randomUUID().slice(0, 8)}`
