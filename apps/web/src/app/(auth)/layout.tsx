import Image from 'next/image'
import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen justify-center px-4 py-16">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex items-center gap-2">
          <Image src="/brand/atlas-icon.png" alt="" width={40} height={40} unoptimized />
          <span className="font-display text-lg font-semibold text-foreground">Atlas</span>
          <span className="text-xs text-muted-foreground">Cloud</span>
        </header>
        {children}
      </main>
    </div>
  )
}
