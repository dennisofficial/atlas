import { CloudIcon, MonitorIcon, TerminalIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@dltech/atlas-ui/components/alert-dialog";
import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";

import { EDeviceKind, type SignedInDevice } from "../../../fixtures/settings-security";
import { SettingsRow } from "../settings-layout";

const DEVICE_ICONS = {
  [EDeviceKind.Browser]: MonitorIcon,
  [EDeviceKind.Cli]: TerminalIcon,
  [EDeviceKind.Sandbox]: CloudIcon,
};

export function DeviceRow({
  device,
  onRevoke,
}: {
  device: SignedInDevice;
  onRevoke: (id: string) => void;
}) {
  const Icon = DEVICE_ICONS[device.kind];
  return (
    <SettingsRow
      media={
        <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      }
      title={
        <>
          {device.name}
          {device.current ? <Badge variant="secondary">This device</Badge> : null}
        </>
      }
      description={<span className="font-mono text-xs">{device.meta}</span>}
      control={
        device.current ? null : (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>Revoke</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke {device.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This device is signed out immediately and must sign in again to use Atlas.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => onRevoke(device.id)}>
                  Revoke
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      }
    />
  );
}
