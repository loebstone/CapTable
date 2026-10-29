import type { Express, Request } from "express";

export function proxyPolicy(raw: string | undefined) {
  if (raw === undefined) return { hops: 1, reason: "TRUSTED_PROXY_HOPS unset; preserving the app's existing value of 1" };
  if (!/^[0-8]$/.test(raw)) throw new Error("TRUSTED_PROXY_HOPS must be an integer from 0 through 8");
  return { hops: Number(raw), reason: "Configured by TRUSTED_PROXY_HOPS" };
}
export function configureProxy(app: Express, raw = process.env.TRUSTED_PROXY_HOPS) {
  const policy = proxyPolicy(raw);
  app.set("trust proxy", policy.hops);
  return policy;
}
export function ssoProxyDiagnostic(req: Request, hops: number) {
  return {
    forwardedFor: req.get("X-Forwarded-For") ?? null,
    socketAddress: req.socket.remoteAddress ?? null,
    resolvedIp: req.ip ?? null,
    trustedProxyHops: hops,
  };
}
