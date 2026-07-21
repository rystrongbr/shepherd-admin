import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startEmailCrons } from "./email";
import { startTrafficCron } from "./traffic";
import { createServer } from "http";
import path from "path";

const app = express();
const httpServer = createServer(app);

// Allow cross-origin requests from the My Shepherd app (deployed on same S3/Perplexity infra)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Stripe webhook MUST receive the raw body so the signature can be verified.
// Registered BEFORE express.json() so the JSON middleware doesn't consume the body.
app.post(
  "/api/donations/webhook",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    // Hand off to the route handler (registered later in registerDonationRoutes).
    // The handler reads req.body as a Buffer.
    next();
  },
);

// SendGrid event webhook also needs the raw body so the Ed25519 signature can
// be verified (the signed payload is `timestamp + rawBody` as bytes).
// Registered BEFORE express.json() for the same reason as the Stripe webhook.
app.post(
  "/api/email/webhook",
  express.raw({ type: "application/json" }),
  (_req, _res, next) => {
    // Hand off to the handler registered later in registerRoutes().
    next();
  },
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Start email module cron jobs (segmentation, etc.). The crons are always
  // registered, but each handler short-circuits when EMAIL_AUTOMATION_ENABLED
  // is false (defense in depth). Reading process.env at run-time inside the
  // handler also means flipping the flag in Railway takes effect without a
  // redeploy.
  startEmailCrons();

  // Start the marketing-traffic cron. Pulls the Cloudflare 30-day unique
  // visitor count daily and writes a snapshot so the Overview "Unique Users"
  // tile self-refreshes. The handler is a no-op when Cloudflare credentials
  // are absent, so this is safe in every environment.
  startTrafficCron();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    // Serve My Shepherd static app at app.myshepherdapp.church
    const myShepherdPath = path.resolve(process.cwd(), "my-shepherd-app");
    const fs = require("fs");

    // Path-based access for previews / non-prod hosts: e.g. Railway PR previews
    // hit https://<preview>.up.railway.app/my-shepherd/ to test Product 1.
    // Production traffic still uses the hostname route below.
    app.use("/my-shepherd", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      const requested = req.path === "/" || req.path === "" ? "/index.html" : req.path;
      const filePath = path.join(myShepherdPath, requested);
      if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
        return res.sendFile(filePath);
      }
      return res.sendFile(path.join(myShepherdPath, "index.html"));
    });

    app.use((req, res, next) => {
      const host = req.hostname || "";

      // Admin subdomain: serve ONLY the admin SPA via serveStatic below.
      // Skip the Product 1 hostname fallback so /api routes work and the
      // admin React app is served at the root of admin.myshepherdapp.church.
      if (host === "admin.myshepherdapp.church") {
        return next();
      }

      // Consumer domains: serve Product 1 static app for all non-API paths.
      if (host === "app.myshepherdapp.church" || host === "www.myshepherdapp.church") {
        if (req.path.startsWith("/api")) return next();
        const filePath = path.join(myShepherdPath, req.path === "/" ? "index.html" : req.path);
        if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
          return res.sendFile(filePath);
        }
        return res.sendFile(path.join(myShepherdPath, "index.html"));
      }
      next();
    });
    // Serve admin dashboard for all other hosts (including admin.myshepherdapp.church)
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
