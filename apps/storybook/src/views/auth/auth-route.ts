export enum EAuthScreen {
  Home = "home",
  SignIn = "sign-in",
  SignUp = "sign-up",
  Forgot = "forgot",
  Reset = "reset",
  DeviceEnter = "device-enter",
  DeviceConfirm = "device-confirm",
  DeviceResult = "device-result",
  Setup = "setup",
  Invite = "invite",
}

export enum EHomeState {
  SignedOut = "signed-out",
  SignedIn = "signed-in",
}

export enum ESignInState {
  Idle = "idle",
  Busy = "busy",
  Error = "error",
  GoogleError = "google-error",
}

export enum ESignInContext {
  Default = "default",
  Device = "device",
  Invite = "invite",
}

export enum ESignUpState {
  Idle = "idle",
  Busy = "busy",
  Error = "error",
}

export enum EForgotState {
  Idle = "idle",
  Sent = "sent",
}

export enum EResetState {
  Idle = "idle",
  Mismatch = "mismatch",
  Success = "success",
  Expired = "expired",
}

export enum EDeviceConfirmState {
  Idle = "idle",
  Busy = "busy",
}

export enum EDeviceResultState {
  Approved = "approved",
  Denied = "denied",
  Expired = "expired",
}

export enum ESetupState {
  Workspace = "workspace",
  Done = "done",
}

export enum EInviteState {
  SignedIn = "signed-in",
  SignedOut = "signed-out",
  Expired = "expired",
}

export type AuthRoute =
  | { screen: EAuthScreen.Home; state?: EHomeState }
  | { screen: EAuthScreen.SignIn; state?: ESignInState; context?: ESignInContext }
  | { screen: EAuthScreen.SignUp; state?: ESignUpState }
  | { screen: EAuthScreen.Forgot; state?: EForgotState; email?: string }
  | { screen: EAuthScreen.Reset; state?: EResetState }
  | { screen: EAuthScreen.DeviceEnter; code?: string }
  | { screen: EAuthScreen.DeviceConfirm; state?: EDeviceConfirmState; code?: string }
  | { screen: EAuthScreen.DeviceResult; state?: EDeviceResultState }
  | { screen: EAuthScreen.Setup; state?: ESetupState; name?: string }
  | { screen: EAuthScreen.Invite; state?: EInviteState };

export type RouteOf<S extends EAuthScreen> = Extract<AuthRoute, { screen: S }>;

export type Navigate = (route: AuthRoute) => void;

export interface ScreenProps<S extends EAuthScreen> {
  route: RouteOf<S>;
  onNavigate?: Navigate;
}
