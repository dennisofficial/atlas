'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { WifiOffIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { ItemGroup } from '@dltech/atlas-ui/components/item'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import {
  EProcessKind,
  isServiceRunning,
  isShellRunning,
  processCommandOf,
  processNameOf,
  serviceReadoutOf,
  serviceToneOf,
  shellReadoutOf,
  shellToneOf,
} from '../data/processes-model'
import { useNow } from '../data/use-now'
import { useProcesses, type ProcessesData } from '../data/use-processes'
import { ProcessRow, STDIN_CLOSED } from './processes-rows'
import { TabPlaceholder } from './tab-placeholder'
import { useThreadPanel } from './thread-panel-context'

const NO_SHELLS = 'Nothing is running in the background.'
const NO_SERVICES = 'Nothing is running as a service.'

function Section(props: {
  title: string
  running: number
  total: number
  empty: string
  children: ReactNode
}) {
  const { title, running, total, empty, children } = props
  const headingId = `processes-${title.toLowerCase()}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="flex items-baseline gap-2 text-xs font-medium">
        {title}
        {total === 0 ? null : (
          <span className="font-mono text-muted-foreground tabular-nums">
            {running}/{total} running
          </span>
        )}
      </h2>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ItemGroup>{children}</ItemGroup>
      )}
    </section>
  )
}

function RunCommand(props: { onStart: (command: string) => Promise<boolean> }) {
  const [command, setCommand] = useState('')
  const [starting, setStarting] = useState(false)
  const trimmed = command.trim()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (trimmed === '' || starting) return
    setStarting(true)
    const started = await props.onStart(trimmed)
    setStarting(false)
    if (started) setCommand('')
  }

  return (
    <form className="flex items-center gap-2" onSubmit={(event) => void handleSubmit(event)}>
      <Input
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="Run a background command"
        aria-label="Background command"
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
      />
      <Button type="submit" variant="outline" disabled={trimmed === '' || starting}>
        {starting ? <Spinner /> : null}
        Run
      </Button>
    </form>
  )
}

export function ProcessesList(props: { data: ProcessesData }) {
  const { shells, services, busyId, notice, selected, log } = props.data
  const { handleSelect, handleKill, handleStop, handleStart } = props.data
  const runningShells = shells.filter(isShellRunning).length
  const runningServices = services.filter(isServiceRunning).length
  const now = useNow(runningShells + runningServices > 0)

  const isOpen = (kind: EProcessKind, id: string) => selected?.kind === kind && selected.id === id
  const toggle = (kind: EProcessKind, id: string) =>
    handleSelect(isOpen(kind, id) ? null : { kind, id })

  return (
    <div className="flex flex-col gap-5 p-3">
      {notice === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <Section title="Shells" running={runningShells} total={shells.length} empty={NO_SHELLS}>
        {shells.map((shell) => (
          <ProcessRow
            key={shell.shellId}
            name={processNameOf(shell)}
            command={processCommandOf(shell)}
            readout={shellReadoutOf({ shell, now })}
            tone={shellToneOf(shell)}
            warning={shell.awaitingInput ? STDIN_CLOSED : undefined}
            action={
              isShellRunning(shell)
                ? {
                    label: 'Kill',
                    busy: busyId !== null,
                    onAction: () => void handleKill(shell.shellId),
                  }
                : undefined
            }
            expanded={isOpen(EProcessKind.Shell, shell.shellId)}
            onToggle={() => toggle(EProcessKind.Shell, shell.shellId)}
            log={log}
            logCaption={`${shell.totalCharacters.toLocaleString('en-US')} chars`}
          />
        ))}
      </Section>
      <RunCommand onStart={handleStart} />
      <Section
        title="Services"
        running={runningServices}
        total={services.length}
        empty={NO_SERVICES}
      >
        {services.map((service) => (
          <ProcessRow
            key={service.serviceId}
            name={processNameOf(service)}
            command={processCommandOf(service)}
            readout={serviceReadoutOf({ service, now })}
            tone={serviceToneOf(service)}
            warning={undefined}
            action={
              isServiceRunning(service)
                ? {
                    label: 'Stop',
                    busy: busyId !== null,
                    onAction: () => void handleStop(service.serviceId),
                  }
                : undefined
            }
            expanded={isOpen(EProcessKind.Service, service.serviceId)}
            onToggle={() => toggle(EProcessKind.Service, service.serviceId)}
            log={log}
            logCaption={undefined}
          />
        ))}
      </Section>
    </div>
  )
}

export function ProcessesTab() {
  const { threadId, channel } = useThreadPanel()
  const data = useProcesses({ threadId, channel })

  if (channel === null) {
    return (
      <TabPlaceholder
        icon={<WifiOffIcon />}
        title="Connecting to the pod"
        description="Shells and services appear as soon as it answers."
      />
    )
  }
  if (!data.loaded) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    )
  }
  return <ProcessesList data={data} />
}
