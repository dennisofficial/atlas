export enum EProjectHeaderAction {
  Settings = 'settings',
  NewSession = 'new-session',
}

export interface IProjectHeaderAction {
  action: EProjectHeaderAction
  label: string
}

export const projectHeaderActionsOf = ({
  projectId,
  title,
}: {
  projectId: string | null
  title: string
}): readonly IProjectHeaderAction[] =>
  projectId === null
    ? []
    : [
        { action: EProjectHeaderAction.Settings, label: 'Project settings' },
        { action: EProjectHeaderAction.NewSession, label: `New session in ${title}` },
      ]

export const projectChevronLabelOf = ({ expanded }: { expanded: boolean }): string =>
  expanded ? 'Collapse project' : 'Expand project'
