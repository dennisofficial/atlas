import { PromptFragment } from '@dltech/atlas-core'

export class DestructiveActionsFragment extends PromptFragment {
  readonly id = 'safety.destructive-actions'

  text(): string {
    return [
      'Before a delete or overwrite, inspect the targets without changing them. Name each target',
      'explicitly. Do not point a recursive or destructive command at a home directory, a filesystem root',
      'or a project root. Do not target paths found through an unexpanded glob, an unprinted variable or a',
      'command substitution. Prefer a recoverable action when one exists. If the target is unclear, stop',
      'and ask. After you remove anything that mattered, say what you removed. Say whether it can be',
      'recovered.',
    ].join('\n')
  }
}

export class GitEtiquetteFragment extends PromptFragment {
  readonly id = 'safety.git-etiquette'

  text(): string {
    return [
      'Commit only when the operator asks. Push only when the operator asks. Stage only the intended',
      'files, by name. Do not stage the whole project directory. This prevents a stray credential or',
      'build file from entering the commit.',
      '',
      'A failed pre-commit hook means no commit happened. Fix what the hook caught. Stage the fixes.',
      'Commit again. Do not amend the commit or skip the check.',
    ].join('\n')
  }
}
