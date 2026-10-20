/// <reference lib="dom" />
import puppeteer, { type Browser } from "puppeteer-core";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { HttpError } from "../errors";

let active = 0;
async function executable() {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const name of ["chromium", "chromium-browser"]) {
      const path = join(directory, name);
      try { await access(path, constants.X_OK); return path; } catch { /* try next runtime path */ }
    }
  }
  throw new HttpError(503, "Headless Chromium is unavailable. Install the configured chromium system dependency.");
}
export async function withPdfBrowser<T>(action: (browser: Browser) => Promise<T>) {
  if (active >= 2) throw new HttpError(429, "Two PDF exports are already running; please try again after they finish");
  active++;
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: await executable(), headless: true, timeout: 30000,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    return await action(browser);
  } finally {
    try { await browser?.close(); } finally { active--; }
  }
}
export async function onePagePdf(browser: Browser, template: string, compact = false) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 816, height: 1056 });
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => { void req.abort().catch(() => undefined); });
    await page.setContent(template, { waitUntil: "load", timeout: 15000 });
    await page.emulateMediaType("print");
    const margin = compact ? 0.32 : 0.55;
    const usableHeight = (11 - margin * 2) * 96 - 3;
    const size = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>(".sheet")!;
      return { height: element.scrollHeight, width: element.scrollWidth, normalWidth: element.getBoundingClientRect().width };
    });
    const scale = Math.min(1, usableHeight / size.height, size.normalWidth / size.width);
    // Never silently truncate, spill to a second page, or make a record unreadable.
    if (scale < 0.65) throw new HttpError(409, "This record has too much content for a readable one-page PDF; no truncated PDF was produced");
    // Chromium print scaling preserves measured table geometry. CSS zoom
    // re-rounds every row and can spill the footer onto a second page.
    return Buffer.from(await page.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true, tagged: true, scale }));
  } finally { await page.close(); }
}
