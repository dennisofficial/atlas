import type { ReactNode } from 'react'

import { CardRow } from '@dltech/atlas-ui/components/card'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { Line } from '@/features/settings/skeletons/primitives'

import { ERowLayout, SettingsCard, SettingsRow, SettingsSection } from './settings-layout'

const BUTTON = 'h-7 rounded-lg'
const KEYS = [0, 1, 2]

function RowSkeleton({
  layout = ERowLayout.Inline,
  lines = 1,
  children,
}: {
  layout?: ERowLayout
  lines?: number
  children?: ReactNode
}) {
  return (
    <SettingsRow
      layout={layout}
      title={<Line width="w-36" />}
      description={
        lines === 0 ? undefined : (
          <div className="flex flex-col">
            {Array.from({ length: lines }, (_, index) => (
              <Line key={index} width={index === 0 ? 'w-full max-w-prose' : 'w-1/2 max-w-sm'} />
            ))}
          </div>
        )
      }
    >
      {children}
    </SettingsRow>
  )
}

const FIELD = <Skeleton className="h-8 w-full rounded-lg" />

function SaveFooter() {
  return <Skeleton className={`${BUTTON} w-14`} />
}

export function ProjectOverviewSkeleton() {
  return (
    <>
      <SettingsSection
        title="Overview"
        description="How Atlas names, clones, and ships this project."
      >
        <SettingsCard footer={<SaveFooter />}>
          <RowSkeleton>{FIELD}</RowSkeleton>
          <RowSkeleton>
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <Skeleton className={`${BUTTON} w-20`} />
          </RowSkeleton>
          <RowSkeleton lines={0}>{FIELD}</RowSkeleton>
          <RowSkeleton>
            <Skeleton className="h-5 w-40" />
          </RowSkeleton>
          <RowSkeleton>{FIELD}</RowSkeleton>
          <RowSkeleton>{FIELD}</RowSkeleton>
          <RowSkeleton layout={ERowLayout.Stacked}>
            <Skeleton className={`${BUTTON} w-40 self-start`} />
          </RowSkeleton>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Danger zone">
        <SettingsCard>
          <RowSkeleton>
            <Skeleton className={`${BUTTON} w-28`} />
          </RowSkeleton>
        </SettingsCard>
      </SettingsSection>
    </>
  )
}

export function SandboxPageSkeleton() {
  return (
    <>
      <SettingsSection
        title="Sandbox size"
        description="vCPUs for every new sandbox in this project. Applies at creation only; an existing sandbox keeps its size."
      >
        <SettingsCard footer={<SaveFooter />}>
          <CardRow>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((key) => (
                <div key={key} className="flex items-start gap-2 rounded-lg border p-2.5">
                  <div className="flex flex-1 flex-col gap-0.5">
                    <Line width="w-16" />
                    <Skeleton className="my-0.5 h-4 w-full" />
                  </div>
                  <Skeleton className="size-4 rounded-full" />
                </div>
              ))}
            </div>
          </CardRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Setup script"
        description="Runs once after the repository is cloned, before the agent starts. Its result is snapshotted."
      >
        <SettingsCard footer={<SaveFooter />}>
          <RowSkeleton layout={ERowLayout.Stacked}>
            <Skeleton className="h-32 w-full rounded-lg" />
          </RowSkeleton>
        </SettingsCard>
      </SettingsSection>
    </>
  )
}

export function PullRequestsSkeleton() {
  return (
    <SettingsSection
      title="Comment edits"
      description="Which authors’ edits to pull request comments reach a conversation subscribed to the pull request, and how quickly."
    >
      <SettingsCard footer={<SaveFooter />}>
        <RowSkeleton layout={ERowLayout.Stacked} lines={2}>
          {FIELD}
        </RowSkeleton>
        <RowSkeleton layout={ERowLayout.Stacked} lines={2}>
          {FIELD}
        </RowSkeleton>
      </SettingsCard>
    </SettingsSection>
  )
}

export function McpPageSkeleton() {
  return (
    <SettingsSection
      title="MCP"
      description="Project servers override your personal servers."
      actions={
        <>
          <Skeleton className={`${BUTTON} w-40`} />
          <Skeleton className={`${BUTTON} w-24`} />
        </>
      }
    >
      <SettingsCard>
        {[0, 1].map((key) => (
          <CardRow key={key} className="flex-row items-center">
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex h-5 items-center gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3.5 w-20" />
              </div>
              <Skeleton className="my-0.5 h-3.5 w-64 max-w-full" />
            </div>
            <Skeleton className="h-[18px] w-8 rounded-full" />
            <Skeleton className="size-7 rounded-lg" />
          </CardRow>
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

export function FilesSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Mounted files</h3>
        <Skeleton className={`${BUTTON} w-24`} />
      </div>
      <Table variant="framed" className="min-w-xl table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[52%]">Path</TableHead>
            <TableHead className="w-[16%]">Mode</TableHead>
            <TableHead className="w-[24%]">Updated</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {KEYS.map((key) => (
            <TableRow key={key}>
              <TableCell>
                <Skeleton className="h-4 w-48" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-10" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="ml-auto size-7 rounded-lg" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
