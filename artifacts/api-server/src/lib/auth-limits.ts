import { HttpError } from "./errors";

const counters = new Map<string, { count: number; start: number; duration: number }>();
export function authLimit(key: string, maximum: number, message = "Too many sign-in attempts; please wait a minute", duration = 60000) {
  const now = Date.now();
  const previous = counters.get(key);
  const counter = previous && now - previous.start < duration ? previous : { count: 0, start: now, duration };
  counter.count++;
  counters.set(key, counter);
  if (counters.size > 2000) for (const [id, item] of counters) if (now - item.start >= item.duration) counters.delete(id);
  if (counter.count > maximum) throw new HttpError(429, message);
}
