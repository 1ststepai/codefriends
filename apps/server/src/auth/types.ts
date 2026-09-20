import type { AuthProvider, ClientKind } from "@codefriends/shared";

export interface ProviderProfile {
  provider: AuthProvider;
  /** Stable account id from the provider. Never a display name. */
  subject: string;
  email?: string;
  displayName?: string;
  usernameHint?: string;
}

export interface OAuthStart {
  authorizationUrl: string;
  state: string;
  codeVerifier?: string;
}

export interface AuthProviderAdapter {
  id: AuthProvider;
  configured: boolean;
  start?(input: { state: string; callbackUrl: string }): Promise<OAuthStart> | OAuthStart;
  complete?(input: {
    code: string;
    callbackUrl: string;
    codeVerifier?: string;
  }): Promise<ProviderProfile>;
}

export interface BeginAuthOptions {
  linkUserId?: string;
  client?: ClientKind;
}
