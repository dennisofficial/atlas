import { Button } from '@dltech/atlas-ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@dltech/atlas-ui/components/card'
import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Atlas Cloud</CardTitle>
          <CardDescription>Account and device sign-in</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            This service hosts Atlas Cloud sign-in. If a device sent you here, follow the link it
            opened instead of this one.
          </p>
          <div className="flex flex-col gap-2">
            <Button size="lg" nativeButton={false} render={<Link href="/sign-in" />}>
              Sign in
            </Button>
            <Button
              variant="outline"
              size="lg"
              nativeButton={false}
              render={<Link href="/sign-up" />}
            >
              Create an account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
