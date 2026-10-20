import { Router } from "express";
import { downloadBackup } from "../lib/backup";

const router = Router();
router.get("/backup/confirm", (req, res) => {
  // Chromium native form POSTs need an origin-preserving document policy.
  // GET only shows confirmation; it never generates a backup or writes data.
  res.setHeader("Referrer-Policy", "strict-origin");
  res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Download HWD Distributions backup</title><style>body{font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#203238}button{padding:12px 20px;font:inherit;background:#884d40;color:white;border:0;border-radius:5px;cursor:pointer}p{line-height:1.6}</style><h1>Download backup</h1><p>This ZIP contains all database records and attached source documents, including private family information. Keep it secure. The app does not retain a copy.</p><p>The maximum size is 500 MB. Preparing the download can take a few minutes. Any error will appear on this page.</p><form method="post" action="${req.baseUrl}/backup"><button type="submit">Confirm and download backup</button></form></html>`);
});
// Mounted after requireAccess; sameOrigin applies globally before API routes.
router.post("/backup", downloadBackup);
export default router;
