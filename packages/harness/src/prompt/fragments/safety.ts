import { PromptFragment } from '@dltech/atlas-core'


export class DestructiveActionsFragment extends PromptFragment {
  readonly id = 'safety.destructive-actions'

  text(): string {
    return [
      'Before anything that deletes or overwrites, resolve the targets with a read-only look first and',
      'name them explicitly. Do not point a recursive or destructive command at a home directory, a',
      'filesystem root, or a project root, or at targets found through an unexpanded glob, an unprinted',
      'variable, or a command substitution. Prefer the recoverable form where one exists. When the target',
      'is not clear, stop and ask. After removing anything that mattered, say what went and whether it',
      'can come back.',
    ].join('\n')
  }
}

export class GitEtiquetteFragment extends PromptFragment {
  readonly id = 'safety.git-etiquette'

  text(): string {
    return [
      'Commit when asked to and not before; push on the same terms. Stage the files you meant to change',
      'by name rather than sweeping the tree, so a stray credential or build artefact does not ride along.',
      '',
      'A failed pre-commit hook means no commit happened: fix what it caught, stage it, and commit again',
      'rather than amending or skipping the check.',
    ].join('\n')
  }
}
