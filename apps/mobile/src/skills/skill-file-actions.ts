export enum ESkillFileAction {
  NewFile = 'new-file',
  NewFolder = 'new-folder',
  Upload = 'upload',
  Rename = 'rename',
  Delete = 'delete',
}

export type SkillFileMenuProps = {
  folder: boolean
  path: string
  onAction: (action: ESkillFileAction) => void
}

export const skillFileActions = (folder: boolean) =>
  folder
    ? [
        ESkillFileAction.NewFile,
        ESkillFileAction.NewFolder,
        ESkillFileAction.Upload,
        ESkillFileAction.Rename,
        ESkillFileAction.Delete,
      ]
    : [ESkillFileAction.Rename, ESkillFileAction.Delete]

export const SKILL_FILE_ACTION_LABELS: Record<ESkillFileAction, string> = {
  [ESkillFileAction.NewFile]: 'New file',
  [ESkillFileAction.NewFolder]: 'New folder',
  [ESkillFileAction.Upload]: 'Upload file',
  [ESkillFileAction.Rename]: 'Rename',
  [ESkillFileAction.Delete]: 'Delete',
}
