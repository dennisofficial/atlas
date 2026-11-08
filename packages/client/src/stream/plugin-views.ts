import type { z } from 'zod'

export const pluginViewOf = <T>(args: {
  views: Readonly<Record<string, unknown>>
  name: string
  schema: z.ZodType<T>
}): T | undefined => {
  if (!Object.hasOwn(args.views, args.name)) return undefined
  return args.schema.parse(args.views[args.name])
}
