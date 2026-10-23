import { LockIcon, PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Toggle } from '@dltech/atlas-ui/components/toggle'

import type { McpEntry } from '../../../fixtures/settings-mcp'

export function EntryRows({
  label,
  entries,
  onChange,
  withSecretToggle,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string
  entries: McpEntry[]
  onChange: (entries: McpEntry[]) => void
  withSecretToggle: boolean
  keyPlaceholder: string
  valuePlaceholder: string
}) {
  const handlePatch = ({ index, patch }: { index: number; patch: Partial<McpEntry> }) =>
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  const handleRemove = (index: number) => onChange(entries.filter((_, i) => i !== index))
  const handleAdd = () => onChange([...entries, { key: '', value: '', secret: false }])

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="w-2/5 font-mono text-xs"
            aria-label={`${label} name ${index + 1}`}
            placeholder={keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            value={entry.key}
            onChange={(event) => handlePatch({ index, patch: { key: event.target.value } })}
          />
          <Input
            className="min-w-0 flex-1 font-mono text-xs"
            aria-label={`${label} value ${index + 1}`}
            placeholder={valuePlaceholder}
            type={entry.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            value={entry.value}
            onChange={(event) => handlePatch({ index, patch: { value: event.target.value } })}
          />
          {withSecretToggle ? (
            <Toggle
              variant="outline"
              size="sm"
              aria-label={`Mark ${label.toLowerCase()} ${index + 1} as secret`}
              pressed={entry.secret}
              onPressedChange={(secret) => handlePatch({ index, patch: { secret } })}
            >
              <LockIcon />
              Secret
            </Toggle>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            onClick={() => handleRemove(index)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit" onClick={handleAdd}>
        <PlusIcon data-icon="inline-start" />
        Add {label.toLowerCase()}
      </Button>
    </div>
  )
}

export function ArgRows({
  args,
  onChange,
}: {
  args: string[]
  onChange: (args: string[]) => void
}) {
  const handlePatch = ({ index, value }: { index: number; value: string }) =>
    onChange(args.map((arg, i) => (i === index ? value : arg)))
  const handleRemove = (index: number) => onChange(args.filter((_, i) => i !== index))

  return (
    <div className="flex flex-col gap-2">
      {args.map((arg, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="font-mono text-xs"
            aria-label={`Argument ${index + 1}`}
            placeholder="-y"
            autoComplete="off"
            spellCheck={false}
            value={arg}
            onChange={(event) => handlePatch({ index, value: event.target.value })}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove argument ${index + 1}`}
            onClick={() => handleRemove(index)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => onChange([...args, ''])}>
        <PlusIcon data-icon="inline-start" />
        Add argument
      </Button>
    </div>
  )
}
