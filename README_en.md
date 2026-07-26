# pi-weixin-bridge

[![CI](https://github.com/ReachForStar/pi-weixin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/ReachForStar/pi-weixin-bridge/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-weixin-bridge.svg)](https://www.npmjs.com/package/pi-weixin-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933.svg)](https://nodejs.org)

**[中文](./README.md)** | English

A bridge service that connects **pi** (a coding agent) to **WeChat ClawBot**. It talks directly to Tencent's official **iLink protocol** — no OpenClaw dependency — with pi integrated in-process via its SDK.

Message ClawBot in WeChat and pi handles it and replies — bringing pi's full capabilities (skills, tools) into the WeChat chat interface.

## Architecture

```
ClawBot in the WeChat app
      ↕  iLink protocol (HTTPS, ilinkai.weixin.qq.com)
┌──────────────────────────────────┐
│  pi-weixin-bridge (this service)  │
│  ① QR login → bot_token           │
│  ② long-poll getUpdates (receive) │
│  ③ download & decrypt inbound media│
│  ④ message + image → pi prompt     │
│  ⑤ pi reply (text / image) → send  │
└──────────────────────────────────┘
      ↕  in-process call (SDK)
   pi AgentSession
```

The protocol is based on Tencent's official open-source repo [`Tencent/openclaw-weixin`](https://github.com/Tencent/openclaw-weixin) (this service strips out the OpenClaw dependency and keeps only the iLink client).

## Prerequisites

- WeChat app **8.0.70+**, with the **ClawBot plugin** enabled on your account (Settings → Plugins → WeChat ClawBot; official gradual rollout)
- Node.js **18+**
- **pi** installed and configured (this service reuses the model & auth config under `~/.pi/agent`)

## Install & Run

### One-line install (recommended, mirrors openclaw-weixin-cli)

```bash
npx -y pi-weixin-bridge install
# Or install from the git source (includes the latest unpublished changes):
npx -y github:ReachForStar/pi-weixin-bridge install
```

`install` will: ① show a QR code for WeChat binding (skipped if an account already exists) → ② set up & save a PM2 resident service → ③ generate hidden-window start/stop shortcuts.

### CLI commands

```bash
pi-weixin-bridge install     # one-line install (QR bind + PM2 + shortcuts)
pi-weixin-bridge login       # QR login / re-bind WeChat
pi-weixin-bridge start       # run the bridge in the foreground (default)
pi-weixin-bridge stop        # stop the PM2 service
pi-weixin-bridge status      # show PM2 service status
pi-weixin-bridge uninstall   # uninstall (remove PM2 service & shortcuts, keep account)
pi-weixin-bridge help        # help
```

### Manual install (clone the source)

```bash
git clone https://github.com/ReachForStar/pi-weixin-bridge.git
cd pi-weixin-bridge
npm install

# Start (shows a QR code on first run; scan with WeChat to connect)
npm start
```

First run: a QR code appears in the terminal → scan with WeChat → confirmed → connected. Account credentials are saved to `~/.pi-weixin-bridge/account.json` and reused on restart, so you don't need to re-scan (it will ask to re-scan automatically when the session expires).

### Run directly via npx

The package is published on [npm](https://www.npmjs.com/package/pi-weixin-bridge) with a `bin` entry (runs the TS source via `tsx/esm/api`, no build step), so you can run it directly with npx:

```bash
# Run directly from npm (QR login required on first run)
npx -y pi-weixin-bridge

# Or install globally and use the command
npm install -g pi-weixin-bridge
pi-weixin-bridge

# Or run from the git source (includes the latest unpublished changes)
npx -y github:ReachForStar/pi-weixin-bridge
```

> npx is great for temporary runs / testing; for a long-running background service, the PM2 approach below is recommended (auto-restart, logs, start-on-boot).

### PM2 resident deployment

> Important: a daemon cannot scan a QR code, so you must **log in interactively once first** (`npm start`, scan, credentials saved to disk), then start it with PM2.

```bash
# 1. First interactive login (scan, then Ctrl+C to exit — the account is saved)
npm start

# 2. Start with PM2 (fork mode, runs TS directly, no build)
npm run pm2:start
npm run pm2:save        # save the process list so it auto-recovers after a pm2 daemon restart

# Common ops
npm run pm2:logs        # view logs
npm run pm2:restart     # restart
npm run pm2:stop        # stop
```

When the session expires (errcode -14) and a re-scan is needed: `npm run pm2:stop` → `npm start` (scan) → `npm run pm2:start`.

### Hidden-window startup (no console popup, PowerShell)

Both the PM2 daemon and the app process carry `windowsHide`, so they don't pop up by themselves; the console window you see at startup comes from the window that runs the start command. Using PowerShell to start hidden gives a fully invisible window:

```powershell
# 1. Generate "double-click, no window" shortcuts (run once)
powershell -NoProfile -ExecutionPolicy Bypass -File create-shortcuts.ps1

# 2. Then just double-click the generated shortcuts (no console):
#    start-pi-weixin-bridge.lnk  → start in background
#    stop-pi-weixin-bridge.lnk   → stop
```

You can also start hidden from the command line directly:

```powershell
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
```

Script notes: `start-service.ps1` / `stop-service.ps1` launch PM2 via `Start-Process -WindowStyle Hidden`; `create-shortcuts.ps1` generates shortcuts that run those scripts with `powershell -WindowStyle Hidden` (the `.lnk` files are generated locally and gitignored).

Start on boot: put `start-pi-weixin-bridge.lnk` in the startup folder (`shell:startup`) or use Task Scheduler; for a Windows-service approach, use `pm2-windows-startup` (`npm i -g pm2-windows-startup && pm2-startup install`).

## Configuration

Override defaults via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PI_WEIXIN_STATE_DIR` | `~/.pi-weixin-bridge` | State directory (account credentials, workspace) |
| `PI_WEIXIN_WORKSPACE` | `D:\pi_weixin_project` | Working directory for pi sessions (the agent reads/writes files here) |

## Project structure

```
src/
├── index.ts          # entry: login, state persistence, session-timeout re-login, graceful shutdown
├── cli.ts            # CLI commands (install/login/start/stop/status/uninstall/help)
├── account.ts        # account credential read/write
├── config.ts         # protocol constants & path config
├── bridge.ts         # main loop: getUpdates → media → pi → sendMessage, typing status
├── ilink/
│   ├── types.ts      # iLink protocol types & enums
│   ├── client.ts     # HTTP client (headers, long-poll, send/receive, getconfig/sendtyping/getuploadurl)
│   ├── login.ts      # QR login flow (redirect, pairing code, expiry refresh)
│   ├── message.ts    # message body extraction (text / voice-to-text)
│   └── media.ts      # media: AES encrypt/decrypt, CDN upload/download, inbound parsing, outbound image upload
└── pi/
    └── sessions.ts   # pi session management (per-WeChat-chat isolation + serialization + image-send tool)
test/                 # unit tests (vitest: AES encrypt/decrypt, message extraction, iLink request construction)
```

## iLink protocol essentials

- **Base URL**: `https://ilinkai.weixin.qq.com` (may switch after login due to IDC scheduling)
- **Headers**: `AuthorizationType: ilink_bot_token`, `Authorization: Bearer <bot_token>`, `X-WECHAT-UIN`, `iLink-App-Id: bot`, etc.
- **Core endpoints**: `get_bot_qrcode` / `get_qrcode_status` (login), `getupdates` (long-poll receive), `sendmessage` (send), `getconfig` / `sendtyping` (typing status), `getuploadurl` (media upload)
- **Key mechanics**: a reply must echo back the inbound message's `context_token`; `getupdates` uses `get_updates_buf` for incremental sync; `errcode -14` means session timeout (re-login needed)
- **Media**: CDN domain `https://novac2c.cdn.weixin.qq.com/c2c`, AES-128-ECB encrypt/decrypt; inbound images are decrypted then base64-encoded for pi's vision, outbound images are uploaded & sent via the `send_weixin_image` tool

## Feature scope

- ✅ QR login + credential persistence + auto re-login on session timeout
- ✅ Text message send/receive (private chat / group @)
- ✅ pi multi-sessions isolated per WeChat chat + serialization
- ✅ "Typing" indicator (getconfig + sendtyping)
- ✅ Inbound media: image (decrypt → pi vision), voice (server-side speech-to-text), file/video (decrypt to disk → report path)
- ✅ Outbound image: pi calls the `send_weixin_image` tool to upload & send a local image
- ✅ PM2 resident deployment (fork mode)
- ⬜ Outbound voice/file/video, slash commands, long-text chunked sending

## ⚠️ Security notice

pi is a coding agent with tool-execution capabilities (includes bash and other tools by default). Once connected to WeChat, **anyone who can message this ClawBot could potentially make pi run commands on your machine** through conversation. Please:

- Use it in private chats only; don't add ClawBot to untrusted group chats
- Restrict pi's working directory via `PI_WEIXIN_WORKSPACE` to limit the blast radius of mistakes
- For stricter permission control, restrict the available tools via the `tools` option of `createAgentSession` in `src/pi/sessions.ts`

## Development

```bash
npm run typecheck   # type check
npm test            # unit tests (vitest)
npm run build       # build to dist/
```

CI: GitHub Actions automatically runs typecheck + test + build on push / PR (Node 20 / 22). On a push to `main`, if the tests pass and the version isn't published yet, it auto-publishes to npm.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| node.exe console pops up at startup | Use PM2 fork mode + the bin wrapper (the default); don't launch directly via the tsx CLI (it spawns an extra child process without `windowsHide`) |
| You send an image but pi says it "can't see it" | pi's global `images.blockImages` being true strips images before they reach the model; set it to false (`~/.pi/agent/settings.json`) |
| "Session expired" / asked to re-scan | errcode -14; run `pi-weixin-bridge login` to re-scan |
| Messages processed twice / conflicts | Don't run multiple instances polling getUpdates for the same WeChat account; make sure only one service is running |
| gh / npx network timeout | github.com connectivity fluctuation; configure a proxy (`HTTPS_PROXY`) and retry |

## License

MIT
