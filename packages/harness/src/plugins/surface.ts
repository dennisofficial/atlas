/**
 * Two anchors rather than a free ordinal: the head of a sidebar column reads as facts about where
 * the session is, and everything below it is a panel with a heading. A contributed section names
 * which of the two it belongs to and takes its turn there in contribution order. The enum lives
 * here rather than with the TUI's rendering types because a repo plugin authored against `'atlas'`
 * must see the same vocabulary whether it loads into the TUI or into `atlas serve` — only whether
 * anyone ever renders the surface differs.
 */
export enum ESidebarPlace {
  Facts = 'facts',
  Panels = 'panels',
}

/**
 * `TSurface` appears only in the return position, so a repo plugin's own UI-shaped hook is
 * assignable to `PluginSurfaceHook<unknown>` without the loader needing to know what a surface
 * looks like. The concrete shape — footer items, sidebar sections — is a TUI rendering concern
 * defined where the TUI renders it; a session with no UI surface, such as `atlas serve`, never
 * calls one.
 */
export type PluginSurfaceHook<TSurface = unknown> = () => TSurface

export const SURFACES_NOTHING = Object.freeze({})

export type ContributedSurface = {
  pluginId: string
  use: PluginSurfaceHook
}
