import type { AuthProviderAdapter, OAuthStart, ProviderProfile } from "./types.js";
import { base64Url, randomBytes, sha256Bytes } from "../crypto.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function googleGeminiAdapter(creds: {
  clientId: string;
  clientSecret: string;
}): AuthProviderAdapter {
  return {
    id: "gemini",
    configured: Boolean(creds.clientId && creds.clientSecret),

    async start({ state, callbackUrl }): Promise<OAuthStart> {
      const codeVerifier = base64Url(randomBytes(32));
      const challenge = base64Url(await sha256Bytes(new TextEncoder().encode(codeVerifier)));
      const url = new URL(AUTH_URL);
      url.searchParams.set("client_id", creds.clientId);
      url.searchParams.set("redirect_uri", callbackUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("access_type", "online");
      url.searchParams.set("prompt", "select_account");
      return { authorizationUrl: url.toString(), state, codeVerifier };
    },

    async complete({ code, callbackUrl, codeVerifier }): Promise<ProviderProfile> {
      const body = new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      });
      if (codeVerifier) body.set("code_verifier", codeVerifier);

      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!tokenRes.ok) {
        throw new Error(`Google token exchange failed (${tokenRes.status})`);
      }
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) throw new Error("Google did not return an access token");

      const infoRes = await fetch(USERINFO_URL, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      if (!infoRes.ok) throw new Error(`Google userinfo failed (${infoRes.status})`);
      const info = (await infoRes.json()) as {
        sub?: string;
        email?: string;
        name?: string;
      };
      if (!info.sub) throw new Error("Google userinfo missing sub");

      return {
        provider: "gemini",
        subject: info.sub,
        email: info.email,
        displayName: info.name,
        usernameHint: info.email?.split("@")[0],
      };
    },
  };
}
