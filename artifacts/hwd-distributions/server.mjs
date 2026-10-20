import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./security-headers.mjs";

// Production static serving needs a response server: a meta tag cannot enforce frame-ancestors.
export function createWebApp() {
  const app = express();
  const root = fileURLToPath(new URL("./dist/public/", import.meta.url));
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set(securityHeaders());
    next();
  });
  app.use(express.static(root, { dotfiles: "deny", index: false }));
  app.get("/{*path}", (req, res) => {
    if (path.extname(req.path)) { res.sendStatus(404); return; }
    res.set("Cache-Control", "no-store").sendFile(path.join(root, "index.html"));
  });
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error("A valid PORT is required");
  createWebApp().listen(port, "0.0.0.0");
}
