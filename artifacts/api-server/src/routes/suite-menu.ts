import { Router } from "express";
import { currentIdentity } from "../lib/auth";
import { getSuiteMenu, suiteToolsVisible } from "../lib/suite-menu";

const router = Router();
router.get("/suite/menu", async (req, res) => {
  const menu = await getSuiteMenu();
  // No session changes: absent apps means Tools stays hidden.
  const apps = (currentIdentity(req) as { apps?: unknown }).apps;
  res.set("Cache-Control", "private, no-store").json({
    ...menu, tools: suiteToolsVisible(apps) ? menu.tools : [],
  });
});
export default router;
