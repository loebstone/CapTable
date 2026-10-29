import app, { trustedProxyPolicy } from "./app";
import { logger } from "./lib/logger";
import { initializeOrigin } from "./lib/origin";
import { BUILD_ID } from "./lib/build";

// Fail startup closed when production has no trusted origin. Never log its value.
initializeOrigin();
logger.info({ trustedProxyHops: trustedProxyPolicy.hops, reason: trustedProxyPolicy.reason }, "Trusted proxy configuration");
logger.info({ build: BUILD_ID }, "Application build");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
