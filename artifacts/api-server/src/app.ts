import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { ZodError } from "zod/v4";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sameOrigin } from "./lib/auth";
import { HttpError } from "./lib/errors";

const app: Express = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sameOrigin);

app.use("/api", router);
const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof ZodError) { res.status(400).json({ error: "Invalid input or response format", details: error.issues.map((i) => ({ path: i.path, message: i.message })) }); return; }
  req.log.error({ errorName: error instanceof Error ? error.name : "Unknown" }, "Request failed");
  res.status(500).json({ error: "The request could not be completed" });
};
app.use(errorHandler);

export default app;
