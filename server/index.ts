import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startEmailCrons } from "./email";
import { startTrafficCron } from "./traffic";
import { createServer } from "http";
import path from "path";
import helmet from "helmet";

const app = express();
const httpServer = createServer(app);
app.disable("x-powered-by");

// ─── /api/v1 shim ───────────────────────────────────────────────────────────
// Mobile clients call /api/v1/*. Web clients keep calling /api/*.
// We rewrite the URL before ANY other middleware runs so downstream code is
// v1-unaware and the two paths are 100% behaviourally identical. The single
// observable difference is the `X-API-Version` response header ("v1" when the
// request came in on the versioned path, absent otherwise) — useful for future
// deprecation of the unversioned aliases.
app.use((req, res, next) => {
  if (req.url.startsWith("/api/v1/") || req.url === "/api/v1") {
    // Strip the /v1 segment; /api/v1/user/me → /api/user/me
    req.url = req.url.replace(/^\/api\/v1(\/|$)/, "/api$1");
    res.setHeader("X-API-Version", "v1");
  }
  next();
});

app.use(helmet({
  hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // HOTFIX 2026-08-17: the previous CSP omitted 'unsafe-inline' and the
      // Google origins, which blocked ALL inline <script> execution on
      // app.myshepherdapp.church — including the PostHog boot snippet and
      // every inline style attribute. That in turn prevented app.js from
      // running its DOMContentLoaded handler, so the modal-open/close JS never
      // fired and the raw HTML rendered every modal panel simultaneously.
      // Restoring 'unsafe-inline' for script + style and allowlisting Google
      // Sign-In, Google Fonts, and gstatic fixes the entire cascade.
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://posthog.com",
        "https://*.posthog.com",
        "https://cdnjs.cloudflare.com",
        "https://accounts.google.com",
        "https://apis.google.com",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://accounts.google.com",
      ],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
      connectSrc: [
        "'self'",
        "https://api.myshepherdapp.church",
        "https://posthog.com",
        "https://*.posthog.com",
        "https://api.anthropic.com",
        "https://accounts.google.com",
      ],
      frameSrc: ["https://accounts.google.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  frameguard: { action: "deny" },
  noSniff: true,
}));
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const productionOrigins = new Set([
  "https://myshepherdapp.church",
  "https://app.myshepherdapp.church",
  "https://admin.myshepherdapp.church",
]);
const developmentOrigins = new Set(["http://localhost:3000", "http://localhost:5173"]);

// CORS is intentionally restricted to first-party browser applications. Native
// apps do not send Origin and are served through bearer authentication instead.
app.use((req, res, next) => {
  const origin = req.header("origin");
  const allowed = new Set(productionOrigins);
  if (process.env.NODE_ENV !== "production") developmentOrigins.forEach(value => allowed.add(value));
  if (origin && !allowed.has(origin)) return res.status(403).json({ error: "Origin is not allowed" });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
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

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
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

    // Legal pages (Privacy Policy + Terms of Service). Required by the App
    // Store and Google Play submission processes. Served as static HTML files
    // out of my-shepherd-app/ so they're host-agnostic (work at either
    // app.myshepherdapp.church/privacy or the Cloudflare marketing site once
    // we hand-mirror them there). Registered BEFORE the SPA fallback so the
    // catch-all doesn't return index.html for /privacy.
    const legalPages: Record<string, string> = {
      "/privacy": "privacy.html",
      "/privacy.html": "privacy.html",
      "/privacy/": "privacy.html",
      "/terms": "terms.html",
      "/terms.html": "terms.html",
      "/terms/": "terms.html",
      "/legal.css": "legal.css",
    };
    app.use((req, res, next) => {
      const file = legalPages[req.path];
      if (!file) return next();
      const contentType = file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.sendFile(path.join(myShepherdPath, file));
    });

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
