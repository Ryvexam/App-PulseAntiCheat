const fs = require("fs");
const crypto = require("crypto");
const {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");
const config = require("./config");

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  },
  forcePathStyle: config.s3.forcePathStyle
});

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function ensureBucket() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    return;
  } catch {
    // Bucket missing or not headable — try to create it below.
  }
  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  } catch (error) {
    // Idempotent: another process (e.g. garage-init) may have created it first.
    const code = error?.Code || error?.name || "";
    if (code === "BucketAlreadyExists" || code === "BucketAlreadyOwnedByYou") return;
    throw error;
  }
}

async function uploadFile({ filePath, key, contentType }) {
  const body = fs.createReadStream(filePath);
  const stat = fs.statSync(filePath);
  const sha256 = sha256File(filePath);

  await s3Client.send(new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: { sha256 }
  }));

  return {
    key,
    bucket: config.s3.bucket,
    size: stat.size,
    sha256,
    url: config.s3.publicBaseUrl
      ? `${config.s3.publicBaseUrl.replace(/\/+$/, "")}/${key}`
      : `/api/evidence/${encodeURIComponent(key)}`
  };
}

async function getObjectStream(key) {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: key
  }));
  return response;
}

module.exports = { ensureBucket, uploadFile, getObjectStream };
