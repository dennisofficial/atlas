import { extname } from 'node:path'

export const extensionOf = ({ path }: { path: string }): string => extname(path).toLowerCase()
