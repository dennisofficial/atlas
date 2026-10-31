import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { MAX_SETUP_SCRIPT_LENGTH } from './new-project-draft'
import { SANDBOX_SIZES, sizeIdOf, vcpusOfSizeId } from './new-project-fixtures'
import type { DraftPatch, ProjectDraft } from './new-project-types'

const SIZE_ITEMS = SANDBOX_SIZES.map((size) => ({ value: size.id, label: size.label }))

export function SandboxOptions({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const handleSizeChange = (next: unknown) => {
    if (typeof next === 'string') patch({ vcpus: vcpusOfSizeId(next) })
  }
  const handleScriptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    patch({ setupScript: event.target.value })

  return (
    <>
      <Field>
        <FieldLabel htmlFor="new-project-size">Sandbox size</FieldLabel>
        <Select items={SIZE_ITEMS} value={sizeIdOf(draft.vcpus)} onValueChange={handleSizeChange}>
          <SelectTrigger id="new-project-size" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIZE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="new-project-setup">
          Setup script <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="new-project-setup"
          className="font-mono text-xs"
          value={draft.setupScript}
          onChange={handleScriptChange}
          placeholder="bun install"
          maxLength={MAX_SETUP_SCRIPT_LENGTH}
          rows={3}
          spellCheck={false}
        />
        <FieldDescription>
          Runs once after the repository is cloned, before the agent starts.
        </FieldDescription>
      </Field>
    </>
  )
}
