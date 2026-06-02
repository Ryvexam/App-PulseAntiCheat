const config = require("./config");

// Known placeholder values shipped in .env.example / defaults. If any of these
// reach a production boot, secrets were never rotated — fail closed.
const WEAK_VALUES = new Set([
  "",
  "change-me-api-token",
  "change-me-dashboard-token",
  "GK0123456789abcdef01234567",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "pulse-garage-admin-token-change-me",
  "pulse-garage-metrics-token-change-me"
]);

function isWeak(value) {
  return WEAK_VALUES.has(String(value || "").trim());
}

/**
 * Refuse to start an unauthenticated server in production. In development the
 * tokens may be empty (auth disabled) to keep local iteration friction-free.
 */
function assertProductionSecrets() {
  if (config.env !== "production") return;

  const problems = [];
  if (isWeak(config.apiToken)) problems.push("PULSE_API_TOKEN is empty or a default placeholder");
  if (isWeak(config.dashboardToken)) problems.push("PULSE_DASHBOARD_TOKEN is empty or a default placeholder");
  if (isWeak(config.s3.accessKeyId)) problems.push("S3_ACCESS_KEY_ID is a default placeholder");
  if (isWeak(config.s3.secretAccessKey)) problems.push("S3_SECRET_ACCESS_KEY is a default placeholder");

  if (problems.length > 0) {
    const detail = problems.map(p => `  - ${p}`).join("\n");
    throw new Error(
      `Refusing to start in production with insecure configuration:\n${detail}\n` +
      `Run ./setup.sh to generate strong secrets, or set NODE_ENV=development for local testing.`
    );
  }
}

/**
 * Conservative security headers for every response. No external dependency.
 * The dashboard injects inline style attributes, so style-src allows
 * 'unsafe-inline'; scripts are external files only.
 */
function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
  );
  if (config.env === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

/** One-line structured access log. Skips noisy health checks. */
function requestLogger(req, res, next) {
  if (req.path === "/health") return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[http] ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

module.exports = { assertProductionSecrets, securityHeaders, requestLogger, isWeak };
