# AI Prompt: Deploy Pulse Hesias with Cloudflare Tunnel

Use this prompt with an AI agent that has shell access to the server/workstation hosting this repository.

```text
You are deploying the Pulse Hesias anti-cheat app from a two-repository workspace.

Goal:
- Deploy the App repository with Docker.
- Expose the dashboard/API publicly at https://anticheat.ryvexam.fr through Cloudflare Tunnel.
- Configure and rebuild the Chrome extension so it sends telemetry to https://anticheat.ryvexam.fr and uses that domain for update checks.
- Verify the public app, local Docker stack, and extension artifacts.

Workspace layout:
- App repo: /Users/maximevery/Dev/AntiCheatHesias/App
- Extension source repo: /Users/maximevery/Dev/AntiCheatHesias/Extension
- Generated extension to load/distribute: /Users/maximevery/Dev/AntiCheatHesias/App/dist/extension
- CRX/update artifacts: /Users/maximevery/Dev/AntiCheatHesias/App/releases

Important constraints:
- Do not commit or print secrets from .env, garage.toml, extension.pem, or Cloudflare credentials.
- Do not edit the generated extension in App/dist/extension directly. Edit Extension/ source files, then rebuild from App/.
- The extension build injects PULSE_BACKEND_URL and PULSE_API_TOKEN into the generated bundle.
- The dashboard token must stay separate from the extension API token.
- Keep PostgreSQL and Garage private behind Docker. Only the app HTTP port should be reachable through the tunnel.

Target public URL:
- https://anticheat.ryvexam.fr

Expected local app port:
- Container listens on 3000.
- Docker Compose maps ${PULSE_APP_HOST_PORT:-3000}:3000.
- Prefer PULSE_APP_HOST_PORT=3000 for deployment unless port 3000 is already used.
- Cloudflare Tunnel should point to http://localhost:${PULSE_APP_HOST_PORT}.

Step 1: Inspect current state
Run:
  cd /Users/maximevery/Dev/AntiCheatHesias/App
  git status --short
  docker compose ps
  cloudflared --version
  cloudflared tunnel list

If Docker is not running, start Docker before continuing.
If cloudflared is not authenticated, run the login/authentication flow for the Ryvexam Cloudflare account before continuing.

Step 2: Configure App/.env for the public domain
Open /Users/maximevery/Dev/AntiCheatHesias/App/.env and update or add these values:

  NODE_ENV=production
  PORT=3000
  PULSE_APP_HOST_PORT=3000
  PULSE_BACKEND_URL=https://anticheat.ryvexam.fr
  CORS_ORIGINS=https://anticheat.ryvexam.fr,https://pulse.hesias.fr,https://*.hesias.fr,https://*.hesias.net,http://localhost:3000
  PULSE_EXAM_ORIGINS=https://*.hesias.fr/*,https://*.hesias.net/*
  PULSE_WHITELIST_URLS=

Do not replace the existing secrets:
- PULSE_API_TOKEN
- PULSE_DASHBOARD_TOKEN
- S3_ACCESS_KEY_ID
- S3_SECRET_ACCESS_KEY
- GARAGE_* tokens/secrets
- MISTRAL_API_KEY

If port 3000 is occupied and you must use another local host port, set PULSE_APP_HOST_PORT to that port and make the Cloudflare Tunnel service point to that same local port. Do not change PULSE_BACKEND_URL away from https://anticheat.ryvexam.fr.

Step 3: Configure Cloudflare Tunnel
Use a named tunnel such as anticheat-ryvexam.

If the named tunnel does not exist:
  cloudflared tunnel create anticheat-ryvexam

Route the hostname:
  cloudflared tunnel route dns anticheat-ryvexam anticheat.ryvexam.fr

Create or update the cloudflared config.

Typical macOS user config:
  ~/.cloudflared/config.yml

Typical service/root config:
  /etc/cloudflared/config.yml

The config must contain the tunnel ID/name and an ingress rule like:

  tunnel: anticheat-ryvexam
  credentials-file: /absolute/path/to/the/tunnel-credentials.json
  ingress:
    - hostname: anticheat.ryvexam.fr
      service: http://localhost:3000
    - service: http_status:404

If PULSE_APP_HOST_PORT is not 3000, replace http://localhost:3000 with the actual local app port.

Start or restart the tunnel.

For a foreground test:
  cloudflared tunnel --config ~/.cloudflared/config.yml run anticheat-ryvexam

For a macOS service installation, use the installed cloudflared service flow appropriate for this machine, then restart the service. Verify with:
  cloudflared tunnel info anticheat-ryvexam
  cloudflared tunnel list

Step 4: Build and start the Docker app
Run:
  cd /Users/maximevery/Dev/AntiCheatHesias/App
  docker compose up -d --build

Verify locally:
  docker compose ps
  curl -s http://localhost:3000/health

Expected health JSON:
  {"ok":true,"version":"1.0.0","storage":"postgres+s3",...}

If the app is on a non-3000 host port, use that port for the local curl.

Step 5: Verify the public Cloudflare URL
Run:
  curl -I https://anticheat.ryvexam.fr/
  curl -s https://anticheat.ryvexam.fr/health
  curl -s https://anticheat.ryvexam.fr/updates.xml

Expected:
- / responds 200.
- /health returns ok true.
- /updates.xml is reachable over HTTPS.
- Response headers should not expose Garage/Postgres ports.

Step 6: Rebuild the extension for the public backend
Run:
  cd /Users/maximevery/Dev/AntiCheatHesias/App
  npm run release:ext

This must:
- Read extension source from ../Extension.
- Build generated extension into App/dist/extension.
- Pack CRX into App/releases/pulse-v1.0.0.crx.
- Generate App/releases/updates.xml.

Verify generated extension config:
  node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("dist/extension/manifest.json","utf8")); console.log({name:m.name,version:m.version,update_url:m.update_url,matches:m.content_scripts?.[0]?.matches});'
  rg "https://anticheat\\.ryvexam\\.fr|PULSE_BACKEND_URL|PULSE_API_TOKEN" dist/extension/background.js dist/extension/content.js dist/extension/manifest.json releases/updates.xml

Expected:
- manifest update_url is https://anticheat.ryvexam.fr/updates.xml
- dist/extension/background.js contains PULSE_BACKEND_URL = "https://anticheat.ryvexam.fr"
- releases/updates.xml codebase points to https://anticheat.ryvexam.fr/releases/pulse-v1.0.0.crx

Step 7: Verify extension release serving through the tunnel
Run:
  curl -I https://anticheat.ryvexam.fr/releases/pulse-v1.0.0.crx
  curl -s https://anticheat.ryvexam.fr/updates.xml

Expected:
- CRX route returns 200 with non-zero content length.
- updates.xml references https://anticheat.ryvexam.fr/releases/pulse-v1.0.0.crx.

Step 8: Run tests
Run:
  cd /Users/maximevery/Dev/AntiCheatHesias/App
  npm test
  npm run lint
  BASE_URL=http://localhost:3000 npm run test:integration

If PULSE_APP_HOST_PORT is not 3000, set BASE_URL to that localhost port.

Optional public smoke test:
  curl -s https://anticheat.ryvexam.fr/health

Do not run integration tests against production data unless you are prepared to clean the generated itest-* sessions afterward.

Step 9: Clean integration test data if integration tests were run
The integration suite creates student IDs like itest-*.

Clean DB rows:
  docker compose exec -T postgres psql -U pulse -d pulse -v ON_ERROR_STOP=1 -c "DELETE FROM exam_sessions WHERE student_id LIKE 'itest-%' RETURNING student_id, exam_id;"

If screenshots were uploaded, also delete matching Garage/S3 objects whose keys start with itest-. Use the app's S3 credentials from .env and the local Garage endpoint.

Step 10: Final operator output
Report:
- App URL: https://anticheat.ryvexam.fr
- Local Docker health result.
- Public /health result.
- Extension source repo: /Users/maximevery/Dev/AntiCheatHesias/Extension
- Built extension folder to load manually: /Users/maximevery/Dev/AntiCheatHesias/App/dist/extension
- CRX path: /Users/maximevery/Dev/AntiCheatHesias/App/releases/pulse-v1.0.0.crx
- Whether Cloudflare Tunnel is running as a service or foreground command.
- Any port deviations from 3000.

Completion criteria:
- docker compose ps shows app, postgres, and garage healthy.
- https://anticheat.ryvexam.fr/health returns ok true.
- https://anticheat.ryvexam.fr/updates.xml is reachable and references HTTPS anticheat.ryvexam.fr CRX codebase.
- dist/extension/manifest.json update_url is https://anticheat.ryvexam.fr/updates.xml.
- dist/extension/background.js is built with PULSE_BACKEND_URL = https://anticheat.ryvexam.fr.
- npm test and npm run lint pass.
```

