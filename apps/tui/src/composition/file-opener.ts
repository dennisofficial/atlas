import type { FileOpener } from '@dltech/atlas-harness'

let opener: FileOpener | null = null

/**
 * The one file opener the app uses, bound at boot to the operator's configured editor. Held at
 * module level so a component deep in the tree (the context viewer) can open a file without the
 * settings object being threaded through composition — the same reach `installLinkClickOpen`
 * already makes for links.
 */
export function installFileOpener(next: FileOpener): void {
  opener = next
}

export function openFileInEditor(target: { path: string; line?: number }): void {
  opener?.(target)
}
