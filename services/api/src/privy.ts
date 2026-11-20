/**
 * Privy sign-in check for the gas grant: an access token signed by Privy for this app proves its holder signed in
 * with Google / X / email / passkey, so the API may ask auto-fund for embedded-wallet gas. Returns the Privy user id, or
 * null when the token is missing, expired, for another app or not signed by Privy.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type VerifyPrivy = (token: string) => Promise<string | null>;

export function privyVerifier(o: { appId: string; issuer: string; keys: JWTVerifyGetKey }): VerifyPrivy {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, o.keys, { issuer: o.issuer, audience: o.appId, algorithms: ["ES256"] });
      return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  };
}

/** Keys from Privy's published set (`jwksUrl` with `{appId}`); fetched and cached by jose. */
export function privyKeys(jwksUrl: string, appId: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl.replace("{appId}", encodeURIComponent(appId))));
}
