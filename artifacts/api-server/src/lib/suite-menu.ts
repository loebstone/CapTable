import { z } from "zod";
import { logger } from "./logger";

const DEFAULT_SITE = "https://hwd-main-site.replit.app";
const link = z.object({ id: z.string().min(1).max(100), label: z.string().min(1).max(100), href: z.string().max(2048), order: z.number().optional() });
const schema = z.object({
  version: z.union([z.string(), z.number()]).transform(String),
  items: z.array(link).max(30), tools: z.array(link).max(20), signOutHref: z.string(),
});
type Links = z.infer<typeof schema>;
export type Menu = Links & { homeHref: string; source: "site" | "fallback" };

function safeHref(value: string, base: string): string {
  const url = new URL(value, base);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Unsafe suite link");
  return url.href;
}
function siteOrigin(value?: string): string {
  if (!value) return DEFAULT_SITE;
  const url = new URL(safeHref(value, DEFAULT_SITE));
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("SITE_BASE_URL must be an origin");
  return url.origin;
}
export function suiteToolsVisible(apps: unknown): boolean {
  return Array.isArray(apps) && apps.some((app) => app === "forecast" || app === "captable");
}
export function fallbackMenu(base = DEFAULT_SITE): Menu {
  return {
    version: "builtin-1", source: "fallback", homeHref: `${base}/`,
    items: [
      { id: "home", label: "Home", href: `${base}/`, order: 0 },
      { id: "announcements", label: "Announcements", href: `${base}/announcements`, order: 1 },
      { id: "scheduler", label: "Scheduler", href: "https://calendar.hwdfarm.com", order: 2 },
      { id: "directory", label: "Family Directory", href: "https://roster.hwdfarm.com", order: 3 },
      { id: "documents", label: "Documents", href: `${base}/documents`, order: 4 },
      { id: "contact", label: "Contact", href: `${base}/contact`, order: 5 },
    ],
    tools: [
      { id: "forecast", label: "Forecast", href: "https://forecast.hwdfarm.com" },
      { id: "captable", label: "Cap Table", href: "https://captable.hwdfarm.com" },
    ],
    signOutHref: "https://roster.hwdfarm.com/sign-out",
  };
}
// Coalesce concurrent requests; cache fallback too so an outage cannot trigger a request flood.
export function createSuiteMenuClient(options: {
  fetch?: typeof fetch; now?: () => number; configured?: () => string | undefined; warn?: () => void;
} = {}) {
  let cached: { key: string | undefined; expires: number; menu: Menu } | undefined;
  let pending: Promise<Menu> | undefined, outage = false;
  const now = options.now ?? Date.now;
  return async function getMenu(): Promise<Menu> {
    const key = (options.configured ?? (() => process.env.SITE_BASE_URL))();
    if (cached && cached.key === key && cached.expires > now()) return cached.menu;
    if (pending) return pending;
    pending = (async () => {
      let base = DEFAULT_SITE, menu: Menu;
      try {
        base = siteOrigin(key);
        if (!key) throw new Error("SITE_BASE_URL unset");
        const response = await (options.fetch ?? fetch)(`${base}/api/suite/menu`, {
          signal: AbortSignal.timeout(5000), redirect: "error", headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Suite menu unavailable");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty suite menu");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 128 * 1024) throw new Error("Suite menu too large");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const text = Buffer.concat(chunks).toString("utf8");
        // logoSvg is deliberately discarded, never forwarded or inserted into HTML.
        const parsed = schema.parse(JSON.parse(text));
        const normalize = (item: z.infer<typeof link>) => ({ ...item, href: safeHref(item.href, base) });
        menu = { ...parsed, items: parsed.items.map(normalize).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
          tools: parsed.tools.map(normalize), signOutHref: safeHref(parsed.signOutHref, base),
          homeHref: `${base}/`, source: "site" };
        outage = false;
      } catch {
        menu = fallbackMenu(base);
        if (!outage) {
          (options.warn ?? (() => logger.warn("Farm suite menu unavailable or unconfigured; using built-in navigation")))();
          outage = true;
        }
      }
      cached = { key, expires: now() + 5 * 60000, menu };
      return menu;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
export const getSuiteMenu = createSuiteMenuClient();
