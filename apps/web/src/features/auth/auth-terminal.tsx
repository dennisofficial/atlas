'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

import { formatUserCode } from '@/lib/auth-api'

const SAMPLE_CODE = 'WDJB-MJHT'
const LOGIN_COMMAND = 'atlas login'

function TerminalWindow({ code }: { code: string }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border bg-background font-mono text-sm shadow-lg"
    >
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ml-2 text-xs text-muted-foreground">~/code/atlas</span>
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-4 leading-relaxed">
        <p className="text-foreground">
          <span className="text-primary">$</span> {LOGIN_COMMAND}
        </p>
        <p className="text-muted-foreground">Open byatlas.io/device and enter:</p>
        <p className="text-xl font-medium tracking-[0.12em] text-foreground">{code}</p>
        <p className="text-muted-foreground">Waiting for approval…</p>
      </div>
    </div>
  )
}

function LiveTerminal() {
  const code = formatUserCode(useSearchParams().get('user_code'))
  return <TerminalWindow code={code.length > 0 ? code : SAMPLE_CODE} />
}

export function AuthTerminal() {
  return (
    <Suspense fallback={<TerminalWindow code={SAMPLE_CODE} />}>
      <LiveTerminal />
    </Suspense>
  )
}
