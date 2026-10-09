export type BakedRuntime = { version: string | null; protocol: string }

export const parseBakedRuntime = (text: string): BakedRuntime => {
  const field = (name: string): string | undefined =>
    text.split('\n').find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1)
  const version = field('version')
  const protocol = field('protocol')
  if (!protocol) throw new Error('incomplete sandbox runtime identity')
  return { version: version || null, protocol }
}
