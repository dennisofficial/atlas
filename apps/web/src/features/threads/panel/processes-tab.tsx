'use client'

import { useId, useState, type FormEvent, type ReactNode } from 'react'
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
  type ProcessRef,
} from '../data/processes-model'
import { declaredNamesOf, undeclaredServicesOf } from '../data/services-model'
import { useDeclaredServices } from '../data/use-declared-services'
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
  lead?: ReactNode
  children: ReactNode
}) {
  const { title, running, total, empty, lead, children } = props
  const headingId = useId()
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
      {lead}
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
    try {
      if (await props.onStart(trimmed)) setCommand('')
    } finally {
      setStarting(false)
    }
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

const listedServicesOf = (args: {
  services: ProcessesData['services']
  declared: ReadonlySet<string>
  selected: ProcessRef | null
}): ProcessesData['services'] => {
  const { services, declared, selected } = args
  const pinned = selected?.kind === EProcessKind.Service ? selected.id : undefined
  return services.filter(
    (service) =>
      service.serviceId === pinned ||
      undeclaredServicesOf({ services: [service], declared }).length > 0,
  )
}

export function ProcessesList(props: { data: ProcessesData; declared: ReadonlySet<string> }) {
  const { shells, busyId, notice, selected, log } = props.data
  const services = listedServicesOf({
    services: props.data.services,
    declared: props.declared,
    selected,
  })
  const { handleSelect, handleKill, handleStop, handleStart } = props.data
  const runningShells = shells.filter(isShellRunning).length
  const runningServices = services.filter(isServiceRunning).length
  const now = useNow(runningShells + runningServices > 0)

  const isOpen = (ref: ProcessRef) => selected?.kind === ref.kind && selected.id === ref.id
  const toggle = (ref: ProcessRef) => handleSelect(isOpen(ref) ? null : ref)

  return (
    <div className="flex flex-col gap-5 p-3">
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {notice ?? ''}
      </p>
      <Section
        title="Shells"
        running={runningShells}
        total={shells.length}
        empty={NO_SHELLS}
        lead={<RunCommand onStart={handleStart} />}
      >
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
            expanded={isOpen({ kind: EProcessKind.Shell, id: shell.shellId })}
            onToggle={() => toggle({ kind: EProcessKind.Shell, id: shell.shellId })}
            log={log}
            logCaption={`${shell.totalCharacters.toLocaleString('en-US')} chars`}
          />
        ))}
      </Section>
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
            expanded={isOpen({ kind: EProcessKind.Service, id: service.serviceId })}
            onToggle={() => toggle({ kind: EProcessKind.Service, id: service.serviceId })}
            log={log}
            logCaption={undefined}
          />
        ))}
      </Section>
    </div>
  )
}

export function ProcessesTab(props: { openServiceId?: string }) {
  const { threadId, channel } = useThreadPanel()
  const { openServiceId } = props
  const data = useProcesses({
    threadId,
    channel,
    initialSelected:
      openServiceId === undefined ? undefined : { kind: EProcessKind.Service, id: openServiceId },
  })
  const declared = useDeclaredServices(channel)

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
  return <ProcessesList data={data} declared={declaredNamesOf(declared.view)} />
}
