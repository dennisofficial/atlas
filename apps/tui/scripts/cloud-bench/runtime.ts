export type BakedRuntime = { version: string | null; protocol: string; bakeId: string }

export const parseBakedRuntime = (text: string): BakedRuntime => {
  const field = (name: string): string | undefined =>
    text.split('\n').find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1)
  const version = field('version')
  const protocol = field('protocol')
  const bakeId = field('bakeId')
  if (!protocol || !bakeId) throw new Error('incomplete baked sandbox runtime identity')
  return { version: version || null, protocol, bakeId }
}
