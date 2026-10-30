export type ServiceRoot = string | (() => string | Promise<string>)

export function rootResolverOf(root: ServiceRoot): () => string | Promise<string> {
  return typeof root === 'string' ? () => root : root
}
