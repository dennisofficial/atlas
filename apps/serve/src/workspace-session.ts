import type { DirectWorkspace } from './direct-workspace'

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>

export function createWorkspaceSession(args: {
  direct: DirectWorkspace
  dormant: boolean
  startChildren: () => Promise<void>
}) {
  let dormant = args.dormant
  let activating: Promise<{ activated: boolean }> | undefined

  const activate = (): Promise<{ activated: boolean }> => {
    if (!dormant) return Promise.resolve({ activated: true })
    activating ??= (async () => {
      await args.startChildren()
      await args.direct.markActivated()
      dormant = false
      return { activated: true }
    })().finally(() => { activating = undefined })
    return activating
  }

  return {
    dormant: (): boolean => dormant,

    apply: async () => {
      const result = await args.direct.apply()
      if (result === null) return null
      if (result.applied) dormant = true
      return {
        applied: result.applied,
        restored: { ...result.restored, trees: [...result.restored.trees] },
      }
    },

    activate,
  }
}
