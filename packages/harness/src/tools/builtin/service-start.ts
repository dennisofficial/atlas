import { stat } from 'node:fs/promises'

import { z } from 'zod'

import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  EServiceStatus,
  EToolEffect,
  ProcessPort,
  SchemaTool,
  serviceEnding,
  serviceEnv,
  serviceNameSchema,
  type DeclaredPathField,
  type PortExposure,
  type ThreadId,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { LocalProcessPort } from '../../execution/local-process'
import { logTail, ServiceRegistryPort } from '../../services'
import { allocateServicePort, processPortProbe } from '../../services/service-port'
import { ensuredLine } from './ensured-lines'
import { exposureClause, exposureUnsupported } from './exposure-prose'

const inputSchema = z.strictObject({
  description: z.string().min(1),
  name: serviceNameSchema.optional(),
  command: z.string().min(1).optional(),
  workdir: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  exposePort: z.number().int().min(1).max(65_535).optional(),
})

const START_TAIL_CHARACTERS = 2_000

const description = [
  'Start a long-running service - a dev server, a database, a cache, anything that keeps serving until it is stopped - and get its id back at once.',
  'This is not for work you are waiting on: a command that ends and whose result you need belongs on bash, backgrounded or not.',
  'A monitor that exits when what it watches finishes - a CI watch, a log tail - is a background bash shell, not a service.',
  'A service never times out and never holds the turn open; if it dies you will be told, wherever you are.',
  'Its stdout and stderr go to one log file, named in the reply; read or grep that file to check on it, and stop it with service_stop.',
  'In bash, pipe the log through the atlas-svc helper: `atlas-svc logs svc_1 | grep ...` resolves the id to its log and execs tail, so -n and -f pass straight through into whatever pipe you build.',
  'Its stdin is closed and it is its own process group, so nothing it forks outlives a stop.',
  "Give it a name to address it later by name; a declared name (in .atlas/services.yaml) with no command starts that service from its declaration - setup, dependencies, health wait and URL, the same as the operator's play button - and command, workdir, port and exposePort are then refused. Any other call needs a command.",
  'It runs with PORT set (port, else exposePort, else a free port from 20000-29999) and ATLAS_THREAD_ID; with exposePort it also gets PUBLIC_URL and the Vite allowed host, so listen on $PORT.',
  'exposePort publishes the port the service listens on and answers with the URL to hand the operator.',
  'In a sandbox - Docker or cloud - any port can be exposed: have the service listen on 0.0.0.0 - 127.0.0.1 is invisible outside the sandbox - and pass the port it listens on; the reply carries the URL to hand the operator, and localhost there is the sandbox, not the operator’s machine.',
].join(' ')

export class ServiceStartTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'service_start'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'workdir',
      presence: EPathPresence.Optional,
      form: EPathForm.Absolute,
      content: EContentAccess.None,
    },
  ]

  constructor(
    private readonly services: ServiceRegistryPort,
    private readonly processes: ProcessPort = new LocalProcessPort(),
  ) {
    super()
  }

  private async resolveExposure(args: {
    containerPort: number | undefined
    threadId: ThreadId
  }): Promise<{ ok: true; exposure: PortExposure | undefined } | { ok: false; reason: string }> {
    if (args.containerPort === undefined) return { ok: true, exposure: undefined }
    if (this.processes.exposePort === undefined) {
      return { ok: false, reason: exposureUnsupported() }
    }

    return await this.processes.exposePort({
      containerPort: args.containerPort,
      threadId: args.threadId,
    })
  }

  private async runDeclared({
    name,
    input,
    threadId,
  }: {
    name: string
    input: z.infer<typeof inputSchema>
    threadId: ThreadId
  }): Promise<ToolOutcome> {
    const extras = (['command', 'workdir', 'port', 'exposePort'] as const).filter(
      (field) => input[field] !== undefined,
    )
    if (extras.length > 0) {
      return {
        ok: false,
        reason: `${name} is declared in .atlas/services.yaml, so it runs from its declaration; drop command/workdir/port/exposePort, or change the declaration`,
      }
    }
    if (this.services.ensureDeclared === undefined) {
      return { ok: false, reason: 'this session cannot manage declared services' }
    }

    const services = await this.services.ensureDeclared({ threadId, names: [name] })
    const failed = services.find((one) => one.name === name && !one.ready)
    const lines = services.map(ensuredLine).join('\n')
    if (failed !== undefined) {
      return {
        ok: false,
        reason: `${lines}\n${name} is not ready${failed.reason === undefined ? '' : `: ${failed.reason}`}; read its log (service_list shows the path).`,
      }
    }
    return { ok: true, output: { services }, modelText: lines }
  }

  protected override async run({
    input,
    projectDirectory,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const declaredNames = (await this.services.declaredNames?.()) ?? []
    if (input.name !== undefined && declaredNames.includes(input.name)) {
      return await this.runDeclared({ name: input.name, input, threadId })
    }
    if (input.command === undefined) {
      const declared = declaredNames.length === 0 ? '' : ` (declared: ${declaredNames.join(', ')})`
      return {
        ok: false,
        reason: `service_start needs a command unless name is declared in .atlas/services.yaml${declared}`,
      }
    }
    const command = input.command
    const cwd = input.workdir ?? projectDirectory

    if (input.workdir !== undefined) {
      const directory = await stat(input.workdir).catch(() => undefined)
      if (directory === undefined) {
        return {
          ok: false,
          reason: `workdir ${input.workdir} does not exist, so there is nowhere to run the service`,
        }
      }
      if (!directory.isDirectory()) {
        return { ok: false, reason: `workdir ${input.workdir} is a file, not a directory` }
      }
    }

    const exposure = await this.resolveExposure({
      containerPort: input.exposePort,
      threadId,
    })
    if (!exposure.ok) return exposure

    const port =
      input.port ??
      input.exposePort ??
      (await allocateServicePort({
        threadId,
        name: input.name ?? input.description,
        isFree: processPortProbe({ processes: this.processes }),
      }))

    const started = await this.services.start({
      threadId,
      port,
      name: input.name,
      env: serviceEnv({ port, threadId, publicUrl: exposure.exposure?.url }),
      command,
      description: input.description,
      cwd,
      exposure: exposure.exposure,
    })
    if (!started.ok) return started

    const { snapshot } = started

    if (snapshot.status !== EServiceStatus.Running) {
      const tail = logTail({ path: snapshot.logPath, characters: START_TAIL_CHARACTERS }).trimEnd()
      return {
        ok: false,
        reason: [
          `Service ${snapshot.serviceId} ${serviceEnding(snapshot)} before it had settled, so it is not running.`,
          tail === '' ? 'Its log is empty.' : `Its log:\n${tail}`,
        ].join('\n\n'),
      }
    }

    return {
      ok: true,
      output: {
        serviceId: snapshot.serviceId,
        command: snapshot.command,
        description: snapshot.description,
        status: snapshot.status,
        ...(snapshot.pid === undefined ? {} : { pid: snapshot.pid }),
        logPath: snapshot.logPath,
        ...(exposure.exposure === undefined ? {} : { exposure: exposure.exposure }),
      },
      modelText: [
        snapshot.pid === undefined
          ? `Started ${snapshot.serviceId} - ${snapshot.description}.`
          : `Started ${snapshot.serviceId} (pid ${snapshot.pid}) - ${snapshot.description}.`,
        `log: ${snapshot.logPath}`,
        'It keeps running after this turn ends and nobody waits on it; if it dies you will be told.',
        ...exposureClause({ exposure: exposure.exposure }),
        `Read the log with the file tools you already have, or pipe it in bash: atlas-svc logs ${snapshot.serviceId} | grep ...`,
        `Stop it with service_stop({ id: "${snapshot.serviceId}" }).`,
      ].join('\n'),
    }
  }
}
