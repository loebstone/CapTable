import { HttpError } from "./errors";

const counters = new Map<string, { count: number; start: number }>();
export function authLimit(key: string, maximum: number) {
  const now = Date.now();
  const previous = counters.get(key);
  const counter = previous && now - previous.start < 60000 ? previous : { count: 0, start: now };
  counter.count++;
  counters.set(key, counter);
  if (counters.size > 2000) for (const [id, item] of counters) if (now - item.start >= 60000) counters.delete(id);
  if (counter.count > maximum) throw new HttpError(429, "Too many sign-in attempts; please wait a minute");
}
