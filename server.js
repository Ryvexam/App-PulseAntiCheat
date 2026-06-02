const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const config = require("./src/config");
const pkg = require("./package.json");
const { query, transaction, pool } = require("./src/db");
const { isInfractionType, getSeverity } = require("./src/scoring");
const { analyzeBehavior } = require("./src/analysis");
const { ensureBucket, uploadFile, getObjectStream } = require("./src/storage");
const { assertProductionSecrets, securityHeaders, requestLogger } = require("./src/security");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

fs.mkdirSync(config.tmpDir, { recursive: true });

function toDate(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
}

function boolFromBody(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  return String(value) === "true";
}

function sanitizeKeyPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function buildCorsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  const allowed = config.corsOrigins.some(pattern => {
    if (pattern === origin) return true;
    if (pattern.includes("*")) {
      const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("\\*", ".*")}$`);
      return regex.test(origin);
    }
    return false;
  });
  callback(allowed ? null : new Error("CORS origin refusée"), allowed);
}

function requireApiToken(req, res, next) {
  if (!config.apiToken) return next();
  const auth = req.get("authorization") || "";
  if (auth !== `Bearer ${config.apiToken}`) {
    return res.status(401).json({ error: "Token API invalide" });
  }
  next();
}

function requireDashboardToken(req, res, next) {
  if (!config.dashboardToken) return next();
  const auth = req.get("authorization") || "";
  const queryToken = req.query.token || "";
  if (auth === `Bearer ${config.dashboardToken}` || queryToken === config.dashboardToken) {
    return next();
  }
  return res.status(401).json({ error: "Accès dashboard non autorisé" });
}

async function getOrCreateSession(client, studentId, examId, studentName) {
  const result = await client.query(`
    INSERT INTO exam_sessions(student_id, exam_id, student_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (student_id, exam_id)
    DO UPDATE SET last_seen_at = now(), updated_at = now(),
                  student_name = COALESCE(EXCLUDED.student_name, exam_sessions.student_name)
    RETURNING *
  `, [studentId, examId, studentName || null]);
  return result.rows[0];
}

async function refreshRiskScore(client, sessionId) {
  const result = await client.query(`
    SELECT COALESCE(SUM(severity), 0)::integer AS score
    FROM exam_events
    WHERE session_id = $1 AND is_infraction = true
  `, [sessionId]);
  const riskScore = Math.min(100, result.rows[0]?.score || 0);
  await client.query(`
    UPDATE exam_sessions
    SET risk_score = $2, last_seen_at = now(), updated_at = now()
    WHERE id = $1
  `, [sessionId, riskScore]);
  return riskScore;
}

function summarizeSession(row) {
  const analysis = analyzeBehavior({
    session: row,
    events: row.analysis_events || [],
    screenshots: row.analysis_screenshots || [],
    heartbeats: row.analysis_heartbeats || [],
    environment: row.environment
  });

  return {
    sessionId: row.id,
    studentId: row.student_id,
    studentName: row.student_name || null,
    examId: row.exam_id,
    status: row.status,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    riskScore: row.risk_score,
    logs: Number(row.logs || 0),
    infractions: Number(row.infractions || 0),
    screenshots: Number(row.screenshots || 0),
    evidenceScreenshots: Number(row.evidence_screenshots || 0),
    latestHeartbeat: row.latest_heartbeat || null,
    environment: row.environment || null,
    topInfractions: row.top_infractions || [],
    analysis
  };
}

async function fetchSessionSummaries() {
  const result = await query(`
    WITH latest_heartbeat AS (
      SELECT DISTINCT ON (session_id) session_id,
        jsonb_build_object(
          'extensionActive', extension_active,
          'sessionActive', session_active,
          'fullscreen', fullscreen,
          'lastUploadStatus', last_upload_status,
          'tabCount', tab_count,
          'windowCount', window_count,
          'currentUrl', current_url,
          'receivedAt', received_at
        ) AS value
      FROM heartbeats
      ORDER BY session_id, received_at DESC
    ),
    top_infraction AS (
      SELECT session_id, jsonb_agg(jsonb_build_object('type', type, 'count', count) ORDER BY count DESC) AS value
      FROM (
        SELECT session_id, type, count(*)::integer AS count
        FROM exam_events
        WHERE is_infraction = true
        GROUP BY session_id, type
      ) grouped
      GROUP BY session_id
    )
    SELECT s.*,
      COUNT(DISTINCT e.id)::integer AS logs,
      COUNT(DISTINCT e.id) FILTER (WHERE e.is_infraction)::integer AS infractions,
      COUNT(DISTINCT sc.id)::integer AS screenshots,
      COUNT(DISTINCT sc.id) FILTER (WHERE sc.kind = 'evidence')::integer AS evidence_screenshots,
      lh.value AS latest_heartbeat,
      ti.value AS top_infractions,
      to_jsonb(env.*) - 'session_id' AS environment,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'type', ev.type,
          'isInfraction', ev.is_infraction,
          'severity', ev.severity,
          'timestamp', ev.occurred_at,
          'details', ev.details
        ) ORDER BY ev.occurred_at)
        FROM exam_events ev
        WHERE ev.session_id = s.id
      ), '[]'::jsonb) AS analysis_events,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'kind', ss.kind,
          'eventType', ss.event_type,
          'timestamp', ss.captured_at,
          'tabUrl', ss.tab_url,
          'tabTitle', ss.tab_title
        ) ORDER BY ss.captured_at)
        FROM screenshots ss
        WHERE ss.session_id = s.id
      ), '[]'::jsonb) AS analysis_screenshots,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'timestamp', hb.received_at,
          'extensionActive', hb.extension_active,
          'sessionActive', hb.session_active,
          'fullscreen', hb.fullscreen
        ) ORDER BY hb.received_at)
        FROM heartbeats hb
        WHERE hb.session_id = s.id
      ), '[]'::jsonb) AS analysis_heartbeats
    FROM exam_sessions s
    LEFT JOIN exam_events e ON e.session_id = s.id
    LEFT JOIN screenshots sc ON sc.session_id = s.id
    LEFT JOIN latest_heartbeat lh ON lh.session_id = s.id
    LEFT JOIN top_infraction ti ON ti.session_id = s.id
    LEFT JOIN environments env ON env.session_id = s.id
    GROUP BY s.id, lh.value, ti.value, env.*
    ORDER BY s.last_seen_at DESC
  `);
  return result.rows.map(summarizeSession);
}

const upload = multer({
  dest: config.tmpDir,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
    else cb(new Error("Format non autorisé"));
  }
});

app.use(securityHeaders);
app.use(requestLogger);
app.use(cors({ origin: buildCorsOrigin }));
app.use(express.json({ limit: "10mb" }));

app.post("/api/exam/screenshots", requireApiToken, upload.single("screenshot"), async (req, res, next) => {
  const {
    studentId,
    examId,
    timestamp,
    kind,
    eventType,
    eventTimestamp,
    relativeMs,
    tabId,
    tabIndex,
    tabUrl,
    tabTitle,
    tabActive,
    windowId
  } = req.body;

  if (!studentId || !examId || !req.file) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Champs manquants : studentId, examId, screenshot" });
  }

  try {
    const capturedAt = toDate(timestamp);
    const safeStudent = sanitizeKeyPart(studentId);
    const safeExam = sanitizeKeyPart(examId);
    const safeKind = sanitizeKeyPart(kind || "screenshot");
    const extension = req.file.mimetype === "image/png" ? "png" : "jpg";
    const objectKey = `${safeStudent}/${safeExam}/${capturedAt.getTime()}_${safeKind}_${req.file.filename}.${extension}`;
    const stored = await uploadFile({
      filePath: req.file.path,
      key: objectKey,
      contentType: req.file.mimetype
    });

    const screenshot = await transaction(async client => {
      const session = await getOrCreateSession(client, studentId, examId);
      const result = await client.query(`
        INSERT INTO screenshots(
          session_id, event_type, event_timestamp, relative_ms, kind,
          object_key, bucket, sha256, size_bytes, mime_type,
          tab_id, tab_index, tab_url, tab_title, tab_active, window_id, captured_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id
      `, [
        session.id,
        eventType || null,
        eventTimestamp ? toDate(eventTimestamp) : null,
        relativeMs !== undefined ? Number(relativeMs) : null,
        kind || "screenshot",
        stored.key,
        stored.bucket,
        stored.sha256,
        stored.size,
        req.file.mimetype,
        tabId || null,
        tabIndex !== undefined ? Number(tabIndex) : null,
        tabUrl || null,
        tabTitle || null,
        boolFromBody(tabActive),
        windowId !== undefined ? Number(windowId) : null,
        capturedAt
      ]);
      await client.query("UPDATE exam_sessions SET last_seen_at = now(), updated_at = now() WHERE id = $1", [session.id]);
      return result.rows[0];
    });

    res.json({ ok: true, id: screenshot.id, objectKey: stored.key, sha256: stored.sha256 });
  } catch (error) {
    next(error);
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

async function persistInfraction(body) {
  const { studentId, examId, studentName, type, timestamp, ...details } = body || {};
  if (!studentId || !examId || !type) throw Object.assign(new Error("missing_fields"), { status: 400 });
  return await transaction(async client => {
    const session = await getOrCreateSession(client, studentId, examId, studentName);
    const severity = getSeverity(type);
    const result = await client.query(`
      INSERT INTO exam_events(session_id, type, severity, is_infraction, details, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [session.id, type, severity, isInfractionType(type), details, toDate(timestamp)]);
    await refreshRiskScore(client, session.id);
    return result.rows[0];
  });
}

app.post("/api/exam/infractions", requireApiToken, async (req, res, next) => {
  try {
    const event = await persistInfraction(req.body);
    res.json({ ok: true, id: event.id });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: "Champs manquants : studentId, examId, type" });
    next(error);
  }
});

app.post("/api/exam/environment", requireApiToken, async (req, res, next) => {
  const { studentId, examId, score, niveau, signaux, userAgent, timestamp } = req.body;
  if (!studentId || !examId) {
    return res.status(400).json({ error: "Champs manquants : studentId, examId" });
  }

  try {
    await transaction(async client => {
      const session = await getOrCreateSession(client, studentId, examId);
      await client.query(`
        INSERT INTO environments(session_id, score, niveau, signaux, user_agent, reported_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (session_id)
        DO UPDATE SET score = EXCLUDED.score, niveau = EXCLUDED.niveau, signaux = EXCLUDED.signaux,
          user_agent = EXCLUDED.user_agent, reported_at = EXCLUDED.reported_at, updated_at = now()
      `, [session.id, score || null, niveau || null, JSON.stringify(signaux || []), userAgent || null, toDate(timestamp)]);
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function persistHeartbeat(body) {
  const {
    studentId, examId, studentName, timestamp, extensionActive, sessionActive, fullscreen,
    lastScreenshotTimestamp, lastUploadStatus, tabCount, windowCount, currentUrl
  } = body || {};
  if (!studentId || !examId) throw Object.assign(new Error("missing_fields"), { status: 400 });
  await transaction(async client => {
    const session = await getOrCreateSession(client, studentId, examId, studentName);
    await client.query(`
      INSERT INTO heartbeats(
        session_id, extension_active, session_active, fullscreen, last_screenshot_at,
        last_upload_status, tab_count, window_count, current_url, received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      session.id,
      boolFromBody(extensionActive),
      sessionActive === undefined ? true : boolFromBody(sessionActive),
      boolFromBody(fullscreen),
      lastScreenshotTimestamp ? toDate(lastScreenshotTimestamp) : null,
      lastUploadStatus || null,
      tabCount ? Number(tabCount) : null,
      windowCount ? Number(windowCount) : null,
      currentUrl || null,
      toDate(timestamp)
    ]);
    await client.query(`
      UPDATE exam_sessions
      SET status = CASE WHEN $2 = false THEN 'ended' ELSE status END,
        last_seen_at = now(), updated_at = now()
      WHERE id = $1
    `, [session.id, sessionActive === undefined ? true : boolFromBody(sessionActive)]);
  });
}

app.post("/api/exam/heartbeat", requireApiToken, async (req, res, next) => {
  try {
    await persistHeartbeat(req.body);
    res.json({ ok: true });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: "Champs manquants : studentId, examId" });
    next(error);
  }
});

app.get("/api/exam/sessions", requireDashboardToken, async (req, res, next) => {
  try {
    res.json(await fetchSessionSummaries());
  } catch (error) {
    next(error);
  }
});

app.get("/api/exam/sessions/:studentId/:examId", requireDashboardToken, async (req, res, next) => {
  try {
    const sessionResult = await query("SELECT * FROM exam_sessions WHERE student_id = $1 AND exam_id = $2", [
      req.params.studentId,
      req.params.examId
    ]);
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "Session introuvable" });

    const [events, screenshots, heartbeats, environment] = await Promise.all([
      query("SELECT * FROM exam_events WHERE session_id = $1 ORDER BY occurred_at ASC", [session.id]),
      query("SELECT *, object_key AS file FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC", [session.id]),
      query("SELECT * FROM heartbeats WHERE session_id = $1 ORDER BY received_at ASC", [session.id]),
      query("SELECT * FROM environments WHERE session_id = $1", [session.id])
    ]);

    const screenshotRows = screenshots.rows.map(row => ({
      id: row.id,
      kind: row.kind,
      eventType: row.event_type,
      eventTimestamp: row.event_timestamp,
      relativeMs: row.relative_ms,
      file: row.object_key,
      url: `/api/evidence/${encodeURIComponent(row.object_key)}${req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : ""}`,
      sha256: row.sha256,
      size: row.size_bytes,
      timestamp: row.captured_at,
      tabId: row.tab_id,
      tabIndex: row.tab_index,
      tabUrl: row.tab_url,
      tabTitle: row.tab_title,
      tabActive: row.tab_active,
      windowId: row.window_id
    }));

    const eventRows = events.rows.map(row => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      isInfraction: row.is_infraction,
      timestamp: row.occurred_at,
      details: row.details
    }));

    const heartbeatRows = heartbeats.rows.map(row => ({
      type: "heartbeat",
      timestamp: row.received_at,
      extensionActive: row.extension_active,
      sessionActive: row.session_active,
      fullscreen: row.fullscreen,
      lastUploadStatus: row.last_upload_status,
      tabCount: row.tab_count,
      windowCount: row.window_count,
      currentUrl: row.current_url
    }));

    res.json({
      sessionId: session.id,
      studentId: session.student_id,
      studentName: session.student_name || null,
      examId: session.exam_id,
      status: session.status,
      startedAt: session.started_at,
      lastSeenAt: session.last_seen_at,
      riskScore: session.risk_score,
      analysis: analyzeBehavior({
        session,
        events: eventRows,
        screenshots: screenshotRows,
        heartbeats: heartbeatRows,
        environment: environment.rows[0] || null
      }),
      logs: eventRows,
      infractions: eventRows.filter(event => event.isInfraction),
      screenshots: screenshotRows,
      heartbeats: heartbeatRows,
      environment: environment.rows[0] || null,
      timeline: [
        ...eventRows,
        ...screenshotRows.map(item => ({ ...item, type: "screenshot" })),
        ...heartbeatRows
      ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/audit/overview", requireDashboardToken, async (req, res, next) => {
  try {
    const sessionsResponse = await fetchSessionSummaries();

    const totals = sessionsResponse.reduce((acc, session) => {
      acc.sessions += 1;
      acc.active += session.status === "active" ? 1 : 0;
      acc.infractions += session.infractions;
      acc.screenshots += session.screenshots;
      acc.highRisk += session.riskScore >= 70 ? 1 : 0;
      return acc;
    }, { sessions: 0, active: 0, infractions: 0, screenshots: 0, highRisk: 0 });

    res.json({ totals, sessions: sessionsResponse });
  } catch (error) {
    next(error);
  }
});

app.get("/api/evidence/:key", requireDashboardToken, async (req, res, next) => {
  try {
    const object = await getObjectStream(decodeURIComponent(req.params.key));
    res.setHeader("Content-Type", object.ContentType || "application/octet-stream");
    object.Body.pipe(res);
  } catch (error) {
    next(error);
  }
});

app.post("/api/ai/analyze/:studentId/:examId", requireDashboardToken, async (req, res, next) => {
  if (!config.mistral.apiKey) {
    return res.status(400).json({ error: "MISTRAL_API_KEY manquant" });
  }

  try {
    const sessionResult = await query("SELECT * FROM exam_sessions WHERE student_id = $1 AND exam_id = $2", [
      req.params.studentId,
      req.params.examId
    ]);
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "Session introuvable" });

    const [events, screenshots, heartbeats, environment] = await Promise.all([
      query("SELECT * FROM exam_events WHERE session_id = $1 ORDER BY occurred_at ASC", [session.id]),
      query("SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC", [session.id]),
      query("SELECT * FROM heartbeats WHERE session_id = $1 ORDER BY received_at ASC", [session.id]),
      query("SELECT * FROM environments WHERE session_id = $1", [session.id])
    ]);

    const eventRows = events.rows.map(row => ({
      type: row.type,
      severity: row.severity,
      isInfraction: row.is_infraction,
      timestamp: row.occurred_at,
      details: row.details
    }));
    const screenshotRows = screenshots.rows.map(row => ({
      id: row.id,
      kind: row.kind,
      eventType: row.event_type,
      eventTimestamp: row.event_timestamp,
      relativeMs: row.relative_ms,
      objectKey: row.object_key,
      sha256: row.sha256,
      size: row.size_bytes,
      timestamp: row.captured_at,
      tabUrl: row.tab_url,
      tabTitle: row.tab_title,
      tabActive: row.tab_active,
      windowId: row.window_id
    }));
    const heartbeatRows = heartbeats.rows.map(row => ({
      timestamp: row.received_at,
      extensionActive: row.extension_active,
      sessionActive: row.session_active,
      fullscreen: row.fullscreen,
      lastUploadStatus: row.last_upload_status,
      tabCount: row.tab_count,
      windowCount: row.window_count,
      currentUrl: row.current_url
    }));
    const env = environment.rows[0] || null;
    const analysis = analyzeBehavior({
      session,
      events: eventRows,
      screenshots: screenshotRows,
      heartbeats: heartbeatRows,
      environment: env
    });

    const evidenceCandidates = screenshotRows
      .filter(shot => shot.kind === "evidence")
      .sort((a, b) => {
        const aScore = /chatgpt|openai|claude|gemini|copilot|perplexity|mistral|poe\.com|you\.com|phind/i.test(a.tabUrl || "") ? 0 : 1;
        const bScore = /chatgpt|openai|claude|gemini|copilot|perplexity|mistral|poe\.com|you\.com|phind/i.test(b.tabUrl || "") ? 0 : 1;
        return aScore - bScore || Math.abs(a.relativeMs || 0) - Math.abs(b.relativeMs || 0);
      })
      .slice(0, 6);

    const imageParts = [];
    for (const shot of evidenceCandidates) {
      try {
        const object = await getObjectStream(shot.objectKey);
        const buffer = await streamToBuffer(object.Body);
        imageParts.push({
          type: "image_url",
          image_url: `data:${object.ContentType || "image/jpeg"};base64,${buffer.toString("base64")}`
        });
      } catch (error) {
        console.warn("[mistral] capture ignorée:", shot.objectKey, error.message);
      }
    }

    const dossier = {
      session: {
        studentId: session.student_id,
        examId: session.exam_id,
        status: session.status,
        startedAt: session.started_at,
        lastSeenAt: session.last_seen_at,
        riskScore: session.risk_score
      },
      deterministicAnalysis: analysis,
      environment: env,
      infractions: eventRows.filter(event => event.isInfraction),
      logs: eventRows.slice(-200),
      heartbeats: heartbeatRows.slice(-120),
      suspiciousScreenshots: evidenceCandidates.map(shot => ({
        eventType: shot.eventType,
        relativeMs: shot.relativeMs,
        timestamp: shot.timestamp,
        tabTitle: shot.tabTitle,
        tabUrl: shot.tabUrl,
        sha256: shot.sha256
      }))
    };

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mistral.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.mistral.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Tu es un analyste anti-triche pour examens en ligne. Tu dois produire une analyse prudente, vérifiable, sans affirmer une fraude sans preuves. Réponds en JSON strict."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyse cette session étudiant. Retourne JSON avec: verdict, suspicion_score, summary, key_findings[], evidence_to_review[], recommended_actions[], limitations. Dossier:\n${JSON.stringify(dossier, null, 2)}`
              },
              ...imageParts
            ]
          }
        ]
      })
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: "Erreur Mistral", details: json });
    }

    const content = json.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = { raw: content }; }

    res.json({
      ok: true,
      model: config.mistral.model,
      input: {
        infractions: dossier.infractions.length,
        logs: dossier.logs.length,
        heartbeats: dossier.heartbeats.length,
        screenshotsSent: imageParts.length
      },
      analysis: parsed
    });
  } catch (error) {
    next(error);
  }
});

const RELEASES_DIR = path.resolve(__dirname, "releases");
app.get("/updates.xml", (req, res) => {
  const xmlPath = path.join(RELEASES_DIR, "updates.xml");
  if (!fs.existsSync(xmlPath)) return res.status(404).type("text/plain").send("no release");
  res.type("application/xml").sendFile(xmlPath);
});
app.use("/releases", express.static(RELEASES_DIR, {
  setHeaders: (res, fp) => {
    if (fp.endsWith(".crx")) res.setHeader("Content-Type", "application/x-chrome-extension");
  }
}));

app.use("/", express.static(config.publicDir));

app.get("/health", async (req, res, next) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, version: pkg.version, storage: "postgres+s3", uptime: process.uptime() });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => res.status(404).json({ error: "Route inconnue" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[error]", err);
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  // Never leak internal error details (stack traces, SQL, paths) in production.
  const message = config.env === "production" && status >= 500 ? "Erreur interne" : err.message;
  res.status(status).json({ error: message });
});

let wssRef = null;
function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws/audit" });
  wssRef = wss;
  wss.on("connection", (ws, req) => {
    try {
      const url = new URL(req.url, "http://x");
      const token = url.searchParams.get("token");
      if (config.apiToken && token !== config.apiToken) {
        ws.close(4401, "unauthorized");
        return;
      }
    } catch {
      ws.close(4400, "bad_url");
      return;
    }
    ws.on("message", async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const id = msg.id || null;
      try {
        let result;
        if (msg.kind === "infraction") result = await persistInfraction(msg.payload);
        else if (msg.kind === "heartbeat") { await persistHeartbeat(msg.payload); result = { ok: true }; }
        else throw new Error("unknown_kind");
        if (id) ws.send(JSON.stringify({ id, ok: true, result }));
      } catch (err) {
        if (id) ws.send(JSON.stringify({ id, ok: false, error: err.message }));
        else console.error("[ws]", err.message);
      }
    });
  });
  console.log("[ws] /ws/audit attached");
}

function installGracefulShutdown(server) {
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — closing gracefully`);
    const force = setTimeout(() => {
      console.error("[shutdown] forced exit after timeout");
      process.exit(1);
    }, 10000);
    force.unref();
    try {
      if (wssRef) wssRef.close();
      await new Promise(resolve => server.close(resolve));
      await pool.end();
      console.log("[shutdown] done");
      process.exit(0);
    } catch (error) {
      console.error("[shutdown] error", error);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function start() {
  assertProductionSecrets();
  await ensureBucket();
  const server = http.createServer(app);
  attachWebSocket(server);
  installGracefulShutdown(server);
  server.listen(config.port, () => {
    console.log(`Pulse Hesias audit app v${pkg.version} listening on http://localhost:${config.port} (${config.env})`);
  });
}

start().catch(async error => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
