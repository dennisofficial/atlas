import { ESessionPaneTab } from './pane-tab'

export type PaneEmptyCopy = { title: string; description: string }

const EMPTY_COPY: Record<ESessionPaneTab, PaneEmptyCopy> = {
  [ESessionPaneTab.Details]: {
    title: 'No session view',
    description: 'This session has streamed no view yet, so there is nothing to read here.',
  },
  [ESessionPaneTab.Changes]: {
    title: 'No workspace tracking',
    description:
      "This session's changes are not recorded. Nothing reports its worktree to the control plane.",
  },
  [ESessionPaneTab.Files]: {
    title: 'No file tree',
    description: 'This session has no cached file tree. Nothing has reported a project listing.',
  },
  [ESessionPaneTab.Terminal]: {
    title: 'Terminal is not connected',
    description: 'Terminals stream from a running pod, and this client has no terminal stream.',
  },
  [ESessionPaneTab.Browser]: {
    title: 'No browser',
    description: "This session's preview ports are not read yet.",
  },
}

export const paneEmptyCopyOf = (tab: ESessionPaneTab): PaneEmptyCopy => EMPTY_COPY[tab]
