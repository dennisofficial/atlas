export enum EPromptGroup {
  Identity = 'identity',
  Delegation = 'delegation',
  ContextFolder = 'context-folder',
  Grilling = 'grilling',
  Memory = 'memory',
}

export const ALL_PROMPT_GROUPS: readonly EPromptGroup[] = Object.values(EPromptGroup)

export const NO_PROMPT_GROUPS: readonly EPromptGroup[] = []
