import type { PathResolver, ResolvedMention } from '@dltech/atlas-harness'

/**
 * The prose pipeline is synchronous and re-runs on every streamed chunk, so it cannot await a
 * lookup. The resolver the composition root installs is itself cache-backed and synchronous, so a
 * mention renders as a link exactly when it names something that exists, and as plain text when
 * it does not — `foundation/structure/etc` never lights up.
 *
 * A module-level slot, not prop drilling: MarkdownView renders many layers beneath the composed
 * app (assistant blocks, tl;dr, thinking, what's-new), and none of them should know the harness
 * exists. `bindPathLinks` runs once at boot; specs that never boot get the no-resolver default,
 * where nothing links and nothing can lie about opening.
 */
let resolver: PathResolver | null = null

export function bindPathLinks(args: { resolve: PathResolver }): void {
  resolver = args.resolve
}

export function unbindPathLinks(): void {
  resolver = null
}

export function resolvePathMention(mention: {
  path: string
  line?: number
}): ResolvedMention | null {
  return resolver === null ? null : resolver(mention)
}
