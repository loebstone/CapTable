import type { Request } from "express";
import { HttpError } from "./errors";
import { logger } from "./logger";

export function configuredOrigin(): string | null {
  const value = process.env.APP_ORIGIN;
  if (!value) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, "APP_ORIGIN is required in production");
    return null;
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash ||
        (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw new Error();
    return url.origin;
  } catch { throw new HttpError(503, "APP_ORIGIN must be a valid origin without credentials, path, query or fragment; production requires HTTPS"); }
}

export function initializeOrigin() {
  if (!configuredOrigin()) logger.warn("DEVELOPMENT ONLY: APP_ORIGIN unset; forwarded-host origin fallback is in use");
}

export function publicOrigin(req: Request): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  // DEVELOPMENT ONLY. Production cannot reach this branch.
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw new HttpError(400, "Invalid application host");
  const proto = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}
