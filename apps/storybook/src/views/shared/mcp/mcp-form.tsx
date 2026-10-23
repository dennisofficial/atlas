import { useId, useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@dltech/atlas-ui/components/collapsible'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import { EMcpAuth, EMcpTransport } from '../../../fixtures/settings-mcp'
import { ArgRows, EntryRows } from './mcp-entry-rows'
import type { McpFormState } from './mcp-form-model'

const SECRET_HINT = 'Use ${NAME} to reference a value from Secrets & Env Vars.'

const AUTH_NOTES: Record<EMcpAuth, string> = {
  [EMcpAuth.OAuth]: 'You sign in after saving.',
  [EMcpAuth.Bearer]: 'Sent as an Authorization header.',
  [EMcpAuth.None]: 'The server is open.',
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function isTransport(value: unknown): value is EMcpTransport {
  return Object.values(EMcpTransport).some((transport) => transport === value)
}

function isAuth(value: unknown): value is EMcpAuth {
  return Object.values(EMcpAuth).some((auth) => auth === value)
}

function OAuthAdvanced({
  form,
  onChange,
}: {
  form: McpFormState
  onChange: (patch: Partial<McpFormState>) => void
}) {
  const idId = useId()
  const secretId = useId()
  const [open, setOpen] = useState(form.clientId !== '')
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <CollapsibleTrigger className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className={open ? 'size-3.5 rotate-90' : 'size-3.5'} />
        Advanced
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Only needed if the server doesn't support dynamic client registration.
        </p>
        <Field label="Client ID" htmlFor={idId}>
          <Input
            id={idId}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
            value={form.clientId}
            onChange={(event) => onChange({ clientId: event.target.value })}
          />
        </Field>
        <Field label="Client secret" htmlFor={secretId}>
          <Input
            id={secretId}
            className="font-mono text-xs"
            type="password"
            autoComplete="off"
            value={form.clientSecret}
            onChange={(event) => onChange({ clientSecret: event.target.value })}
          />
        </Field>
      </CollapsibleContent>
    </Collapsible>
  )
}

function RemoteFields({
  form,
  onChange,
}: {
  form: McpFormState
  onChange: (patch: Partial<McpFormState>) => void
}) {
  const urlId = useId()
  const tokenId = useId()
  return (
    <>
      <Field label="URL" htmlFor={urlId}>
        <Input
          id={urlId}
          className="font-mono text-xs"
          placeholder="https://mcp.example.com/mcp"
          autoComplete="off"
          spellCheck={false}
          value={form.url}
          onChange={(event) => onChange({ url: event.target.value })}
        />
      </Field>
      <Field label="Authentication" hint={AUTH_NOTES[form.authKind]}>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[form.authKind]}
          onValueChange={(next) => {
            const first = next[0]
            if (isAuth(first)) onChange({ authKind: first })
          }}
          aria-label="Authentication"
        >
          <ToggleGroupItem value={EMcpAuth.OAuth}>OAuth</ToggleGroupItem>
          <ToggleGroupItem value={EMcpAuth.Bearer}>Bearer token</ToggleGroupItem>
          <ToggleGroupItem value={EMcpAuth.None}>None</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {form.authKind === EMcpAuth.OAuth ? <OAuthAdvanced form={form} onChange={onChange} /> : null}
      {form.authKind === EMcpAuth.Bearer ? (
        <Field label="Token" htmlFor={tokenId} hint={SECRET_HINT}>
          <Input
            id={tokenId}
            className="font-mono text-xs"
            type="password"
            autoComplete="off"
            value={form.token}
            onChange={(event) => onChange({ token: event.target.value })}
          />
        </Field>
      ) : null}
      <Field label="Headers">
        <EntryRows
          label="Header"
          entries={form.headers}
          onChange={(headers) => onChange({ headers })}
          withSecretToggle
          keyPlaceholder="X-Team"
          valuePlaceholder="Value"
        />
      </Field>
    </>
  )
}

function LocalFields({
  form,
  onChange,
}: {
  form: McpFormState
  onChange: (patch: Partial<McpFormState>) => void
}) {
  const commandId = useId()
  return (
    <>
      <Field
        label="Command"
        htmlFor={commandId}
        hint="Runs inside the sandbox, so the binary must be installed by the setup script."
      >
        <Input
          id={commandId}
          className="font-mono text-xs"
          placeholder="npx -y @modelcontextprotocol/server-postgres"
          autoComplete="off"
          spellCheck={false}
          value={form.command}
          onChange={(event) => onChange({ command: event.target.value })}
        />
      </Field>
      <Field label="Arguments">
        <ArgRows args={form.args} onChange={(args) => onChange({ args })} />
      </Field>
      <Field label="Environment" hint={SECRET_HINT}>
        <EntryRows
          label="Variable"
          entries={form.env}
          onChange={(env) => onChange({ env })}
          withSecretToggle={false}
          keyPlaceholder="DATABASE_URL"
          valuePlaceholder="${DATABASE_URL}"
        />
      </Field>
    </>
  )
}

export function McpForm({
  form,
  editing,
  onChange,
}: {
  form: McpFormState
  editing: boolean
  onChange: (patch: Partial<McpFormState>) => void
}) {
  const nameId = useId()
  return (
    <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-0.5 py-0.5">
      <Field label="Name" htmlFor={nameId}>
        <Input
          id={nameId}
          className="font-mono text-xs"
          placeholder="linear"
          autoComplete="off"
          spellCheck={false}
          disabled={editing}
          value={form.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </Field>
      <Field label="Type">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[form.transport]}
          onValueChange={(next) => {
            const first = next[0]
            if (isTransport(first)) onChange({ transport: first })
          }}
          aria-label="Type"
        >
          <ToggleGroupItem value={EMcpTransport.Http}>Remote URL</ToggleGroupItem>
          <ToggleGroupItem value={EMcpTransport.Stdio}>Local command</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {form.transport === EMcpTransport.Http ? (
        <RemoteFields form={form} onChange={onChange} />
      ) : (
        <LocalFields form={form} onChange={onChange} />
      )}
    </div>
  )
}
