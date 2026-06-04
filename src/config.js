const path = require("path");

const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  corsOrigins: (process.env.CORS_ORIGINS || "https://pulse.hesias.fr,https://*.hesias.fr,https://*.hesias.net,chrome-extension://*,http://localhost:3000")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || "postgres://pulse:pulse@localhost:5432/pulse",
  tmpDir: process.env.UPLOAD_TMP_DIR || path.join(__dirname, "..", "tmp"),
  publicDir: path.join(__dirname, "..", "public"),
  officialExtensionId: process.env.CWS_ITEM_ID || "",
  s3: {
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    region: process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "pulse-evidence",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "GK0123456789abcdef01234567",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || ""
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || "",
    model: process.env.MISTRAL_MODEL || "mistral-small-latest"
  }
};

module.exports = config;
