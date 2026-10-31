import { useState } from 'react'
import { EyeIcon, EyeOffIcon, PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { parseEnvLines, secretsErrorOf, type SecretPair } from './new-project-secrets'
import type { DraftPatch, ProjectDraft } from './new-project-types'

export function SecretsEditor({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const [pasting, setPasting] = useState(false)
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const error = secretsErrorOf(draft.secrets)
  const handleChange = ({ index, changes }: { index: number; changes: Partial<SecretPair> }) =>
    patch({
      secrets: draft.secrets.map((pair, row) => (row === index ? { ...pair, ...changes } : pair)),
    })
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const { pairs, invalid } = parseEnvLines(event.clipboardData.getData('text'))
    if (invalid.length > 0) {
      setPasteError(`Fix lines ${invalid.join(', ')}: expected NAME=value. No values were added.`)
      return
    }
    setRevealedIndex(null)
    patch({ secrets: [...draft.secrets, ...pairs] })
    setPasteError(null)
    setPasting(false)
  }
  const handleAdd = () => patch({ secrets: [...draft.secrets, { name: '', value: '' }] })
  return (
    <FieldSet data-invalid={error ? true : undefined}>
      <FieldLegend variant="label">
        Secrets &amp; Env Vars <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLegend>
      <FieldDescription>Encrypted values available to threads in this project.</FieldDescription>
      {draft.secrets.map((pair, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={`project-secret-name-${index}`}>Name</FieldLabel>
            <Input
              id={`project-secret-name-${index}`}
              className="font-mono md:text-xs"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              value={pair.name}
              placeholder="API_KEY"
              onChange={(event) => handleChange({ index, changes: { name: event.target.value } })}
            />
          </Field>
          <Field className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
            <FieldLabel htmlFor={`project-secret-value-${index}`}>Value</FieldLabel>
            <div className="flex items-center gap-1">
              <Input
                id={`project-secret-value-${index}`}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                className={
                  revealedIndex === index
                    ? '[-webkit-text-security:none]'
                    : '[-webkit-text-security:disc]'
                }
                value={pair.value}
                onChange={(event) =>
                  handleChange({ index, changes: { value: event.target.value } })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${revealedIndex === index ? 'Hide' : 'Reveal'} value ${index + 1}`}
                aria-pressed={revealedIndex === index}
                onClick={() => setRevealedIndex(revealedIndex === index ? null : index)}
              >
                {revealedIndex === index ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
            </div>
          </Field>
          <Button
            variant="ghost"
            size="icon"
            className="col-start-2 row-start-1 sm:col-start-3"
            aria-label={`Remove ${pair.name || 'value'} ${index + 1}`}
            onClick={() => {
              setRevealedIndex(null)
              patch({ secrets: draft.secrets.filter((_, row) => row !== index) })
            }}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {error ? <FieldError role="alert">{error}</FieldError> : null}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleAdd}>
          <PlusIcon data-icon="inline-start" />
          Add value
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPasting(!pasting)
            setPasteError(null)
          }}
        >
          Paste .env
        </Button>
      </div>
      {pasting ? (
        <Field>
          <FieldLabel htmlFor="project-env-paste">Paste NAME=value lines</FieldLabel>
          <Textarea
            id="project-env-paste"
            value=""
            onChange={() => undefined}
            onPaste={handlePaste}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            placeholder="Paste your .env here; values will be masked immediately."
            rows={2}
            aria-invalid={pasteError ? true : undefined}
          />
          {pasteError ? (
            <FieldError role="alert">{pasteError}</FieldError>
          ) : (
            <FieldDescription>Blank lines and # comments are ignored.</FieldDescription>
          )}
        </Field>
      ) : null}
    </FieldSet>
  )
}
