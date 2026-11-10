'use client'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'
import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { NativeSelect } from '@dltech/atlas-ui/components/native-select'

import { SCHEDULE_PREVIEW } from './routines.fixtures'

const LABEL = 'flex flex-col gap-1.5 text-sm font-medium'
const CONTROL =
  'w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

export function RoutineCreateSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>New routine</SheetTitle>
          <SheetDescription>
            A saved prompt on a schedule. Each run is a fresh session, on this project.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <label className={LABEL} htmlFor="routine-name">
            Name
            <Input id="routine-name" defaultValue="Dead code sweep" />
          </label>

          <label className={LABEL} htmlFor="routine-project">
            Project
            <NativeSelect id="routine-project" defaultValue="atlas">
              <option value="atlas">dennisofficial/atlas</option>
              <option value="rs-crm">dennisofficial/rs-crm</option>
            </NativeSelect>
          </label>

          <div className="flex flex-col gap-1.5">
            <label className={LABEL} htmlFor="routine-schedule">
              Schedule
              <Input id="routine-schedule" defaultValue="0 7 * * 1-5" className="font-mono" />
            </label>
            <Field>
              <FieldDescription>{SCHEDULE_PREVIEW.human} · Europe/London</FieldDescription>
            </Field>
            <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
              <p className="mb-1 text-muted-foreground">Next three runs</p>
              {SCHEDULE_PREVIEW.occurrences.map((occurrence) => (
                <p key={occurrence} className="font-mono tabular-nums">
                  {occurrence}
                </p>
              ))}
              <p className="mt-1.5 text-muted-foreground">
                ≈ {SCHEDULE_PREVIEW.perMonth} runs / month · minimum gap 5 minutes
              </p>
            </div>
          </div>

          <label className={LABEL} htmlFor="routine-model">
            Model
            <NativeSelect id="routine-model" defaultValue="opus-5-5">
              <option value="opus-5-5">opus-5-5</option>
              <option value="sonnet-4-6">sonnet-4-6</option>
            </NativeSelect>
          </label>

          <label className={LABEL}>
            Prompt
            <textarea
              defaultValue={
                'Sweep the workspace for code nothing references. Prove each hit is dead, remove it one commit at a time, and open a PR with the evidence.'
              }
              rows={7}
              className={CONTROL}
            />
          </label>
          <Field>
            <FieldLabel className="sr-only">Prompt help</FieldLabel>
            <FieldDescription>
              The prompt is sent as the session&rsquo;s first message, unchanged. Rewrites are yours
              to make; the agent cannot edit a routine.
            </FieldDescription>
          </Field>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-4">
          <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
          <Button>Create routine</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
