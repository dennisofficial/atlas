import { z } from 'zod'

export enum EServiceAction {
  Start = 'start',
  Stop = 'stop',
  Restart = 'restart',
  List = 'list',
}

const serviceInputBase = z.strictObject({
  action: z.enum(EServiceAction),
  serviceId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  workdir: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  exposePort: z.boolean().optional(),
  readyTimeoutMs: z.number().int().positive().optional(),
  runningOnly: z.boolean().optional(),
})

export type ServiceInput = z.output<typeof serviceInputBase>

const needsOne = (args: {
  fields: readonly ('serviceId' | 'name')[]
  action: EServiceAction
  input: ServiceInput
  ctx: z.RefinementCtx
}): void => {
  const passed = args.fields.filter((field) => args.input[field] !== undefined)
  if (passed.length === 1) return
  args.ctx.addIssue({
    code: 'custom',
    path: [args.fields[0] ?? 'serviceId'],
    message:
      passed.length === 0
        ? `action "${args.action}" needs a serviceId or a declared name, exactly one`
        : `action "${args.action}" takes a serviceId or a declared name, not both`,
  })
}

export const serviceInputSchema = serviceInputBase.superRefine((input, ctx) => {
  if (input.action === EServiceAction.Start) {
    if (input.name !== undefined && input.command !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message:
          'action "start" takes a name or a command, not both: drop the one you did not mean to pass',
      })
    }
    if (input.name === undefined && input.command === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message:
          'action "start" needs a name - a service declared in .atlas/services.yaml - or a command',
      })
    }
    return
  }
  if (input.action === EServiceAction.Restart) {
    needsOne({ fields: ['serviceId', 'name'], action: input.action, input, ctx })
    return
  }
  if (
    input.action === EServiceAction.Stop &&
    input.serviceId === undefined &&
    input.name === undefined
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['serviceId'],
      message: 'action "stop" needs a serviceId or a declared name',
    })
  }
})
