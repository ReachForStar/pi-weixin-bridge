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
- Node.js **22+** (the pi-coding-agent SDK and its bundled undici require Node 22)
- **pi** installed and configured (this service reuses the model & auth config under `~/.pi/agent`)

## Install & Run

### One-line install (recommended, mirrors openclaw-weixin-cli)

```bash
npx -y pi-weixin-bridge install
# Or install from the git source (includes the latest unpublished changes):
npx -y github:ReachForStar/pi-weixin-bridge install
```

`install` will: ① interactively choose save paths (state dir / pi workspace; Enter for defaults, or `install --yes` to skip prompts) → ② show a QR code for WeChat binding (skipped if an account already exists) → ③ start the built-in background daemon (auto-restart on crash, zero third-party deps) → ④ generate hidden-window start/stop shortcuts (Windows only).

Path selection notes:

- **State directory**: where account credentials, session context and daemon logs live; defaults to `~/.pi-weixin-bridge`. Your choice is written to `~/.pi-weixin-bridge/config.json` and picked up automatically by every process (including daemon children)
- **pi workspace**: the agent's read/write working area; defaults to `D:\pi_weixin_project` on Windows, `~/pi-weixin-project` elsewhere
- Both directories are **probe-tested for writability** before installation; on POSIX the state dir is tightened to `700` and the account file to `600` (credentials unreadable by other users)

### CLI commands

```bash
pi-weixin-bridge install     # one-line install (QR bind + background daemon + shortcuts)
pi-weixin-bridge login       # QR login / re-bind WeChat
pi-weixin-bridge start       # run the bridge in the foreground (default)
pi-weixin-bridge stop        # stop the background daemon
pi-weixin-bridge status      # show background daemon status
pi-weixin-bridge daemon      # daemon management: start/stop/status/restart/logs/install-boot/uninstall-boot
pi-weixin-bridge update      # update to latest (git install: git pull + npm install + restart)
pi-weixin-bridge uninstall   # uninstall (stop service, remove boot task & shortcuts, keep account)
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

> npx is great for temporary runs / testing; for a long-running background service, the built-in daemon below is recommended (auto-restart, logs, start-on-boot).

### Background daemon deployment (built-in, recommended)

> Important: a background process cannot scan a QR code, so you must **log in interactively once first** (`npm start`, scan, credentials saved to disk), then start the daemon.

```bash
# 1. First interactive login (scan, then Ctrl+C to exit — the account is saved)
npm start

# 2. Start the background daemon (a supervisor keeps it alive: auto-restart on crash, exponential backoff, log rotation)
pi-weixin-bridge daemon start
pi-weixin-bridge daemon status    # show status
pi-weixin-bridge daemon logs      # view logs (last 50 lines)
pi-weixin-bridge daemon restart   # restart
pi-weixin-bridge daemon stop      # stop
```

Differences from PM2: the built-in daemon has zero third-party dependencies, and PID/logs live in `~/.pi-weixin-bridge/daemon/` (unaffected by npx temp-dir cleanup), cross-platform (Windows/POSIX).

**Session expiry (errcode -14) and re-scanning**: a background process cannot scan interactively, so the log will tell you to:

```
[main] Cannot scan QR in background mode. Run `pi-weixin-bridge login` in a terminal to re-scan; the service resumes automatically once scanning completes.
```

Just run `pi-weixin-bridge login` in any terminal and scan; the daemon detects the new account and resumes automatically — no service restart needed.

**Start on boot (optional)**:

```bash
pi-weixin-bridge daemon install-boot     # register a per-user logon scheduled task (no admin, hidden window)
pi-weixin-bridge daemon uninstall-boot   # remove it
```

### Hidden-window startup (no console popup, PowerShell)

The daemon process carries `windowsHide`, so it has no console window of its own; the console you see at startup comes from the window that runs the start command. Starting hidden via PowerShell keeps everything invisible:

```powershell
# 1. Generate "double-click, no window" shortcuts (run once)
powershell -NoProfile -ExecutionPolicy Bypass -File create-shortcuts.ps1

# 2. Then just double-click the generated shortcuts (no console):
#    start-pi-weixin-bridge.lnk  → start in background (daemon start)
#    stop-pi-weixin-bridge.lnk   → stop (daemon stop)
```

You can also start hidden from the command line directly:

```powershell
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File start-service.ps1
```

Script notes: `start-service.ps1` / `stop-service.ps1` call `daemon start/stop` via `Start-Process -WindowStyle Hidden`; `create-shortcuts.ps1` generates shortcuts that run those scripts with `powershell -WindowStyle Hidden` (the `.lnk` files are generated locally and gitignored).

### PM2 (optional alternative)

If you already rely on the PM2 ecosystem, it still works (`npm run pm2:start / pm2:stop / pm2:logs`), but on Windows you must keep the pm2 daemon alive separately; this project's default path and the `install` command have switched to the built-in daemon.

### Linux / WSL

This project is cross-platform (Windows / Linux / macOS; the daemon's process-tree kill adapts per platform). Linux supports the same background daemon and headless re-login flow.

```bash
git clone https://github.com/ReachForStar/pi-weixin-bridge.git
cd pi-weixin-bridge && npm install
pi-weixin-bridge install --yes   # non-interactive install (all default paths)
pi-weixin-bridge login           # first scan (a background process cannot scan, log in interactively once)
pi-weixin-bridge daemon start    # run in background
```

- The install wizard automatically uses default paths in non-TTY environments (CI / SSH without a terminal); in an interactive terminal it prompts for the state dir and workspace.
- Start on boot uses a **systemd user service** (no root required):
  ```bash
  pi-weixin-bridge daemon install-boot     # register & enable the systemd user service
  pi-weixin-bridge daemon uninstall-boot   # remove it
  ```
  To start on boot **without a login session**, an admin must run `loginctl enable-linger <username>`.
- WSL requires systemd enabled (`wsl --update` + systemd as PID 1 in the distro); otherwise `daemon install-boot` reports it unavailable — use `daemon start` manually.
- On Linux the credentials file is tightened to `600` and the state dir to `700` automatically.
- Note: WSL and Windows have different `~`, so the two sides keep independent accounts/state.

## Configuration

Resolution priority: **environment variables > `~/.pi-weixin-bridge/config.json` (written by the install wizard) > platform defaults**.

| Variable | Default | Description |
|---|---|---|
| `PI_WEIXIN_STATE_DIR` | `~/.pi-weixin-bridge` | State directory (account credentials, session context, daemon logs) |
| `PI_WEIXIN_WORKSPACE` | Windows `D:\pi_weixin_project` / others `~/pi-weixin-project` | Working directory for pi sessions (the agent reads/writes files here) |

`config.json` example (generated by `install`, editable by hand):

```json
{ "stateDir": "D:\\data\\piwx", "workspace": "D:\\pi_weixin_project" }
```

Permissions: on POSIX the state dir and account file are tightened to `700` / `600`; on Windows the user-home ACL applies (current user only by default).

## Project structure

```
src/
├── index.ts          # entry: login, state persistence, session-timeout re-login, graceful shutdown
├── cli.ts            # CLI commands (install/login/start/stop/status/uninstall/help)
├── account.ts        # account credential read/write
├── config.ts         # protocol constants & path config
├── bridge.ts         # main loop: getUpdates → media → pi → sendMessage, typing status
├── daemon/           # built-in background daemon (zero third-party deps, replaces PM2)
│   ├── daemon.ts     # control side: start/stop the supervisor process tree, PID & logs, backoff policy
│   ├── supervisor.ts # supervisor process: auto-restart the child on crash (exponential backoff)
│   └── boot.ts       # start-on-boot: register/remove per-user logon scheduled task (no admin)
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
- ✅ Outbound media: image/file/video uploaded to CDN and sent (`send_weixin_image` tool + builder)
- ✅ Long-text chunked sending (markdown chunking, avoids WeChat single-message length limit)
- ✅ Slash commands (`/help` `/status` `/new` `/model` `/skill` `/mcp` `/usage` `/stop` `/ping`), unknown commands fall through to pi
- ✅ Built-in background daemon (auto-restart on crash + log rotation + start-on-boot, zero third-party deps; Windows scheduled task / Linux systemd user service; PM2 kept as an optional path)
- ✅ Cross-platform (Windows / Linux / macOS), install wizard with interactive path selection + credentials permission hardening (POSIX 700/600)
- ⬜ Outbound voice (needs silk encoding, not done)

### Model

- **Default model** `amax/qwen-3.8-27B` (built-in); `/model <provider/modelId>` switches to any model registered in `~/.pi/agent/models.json`, the choice is saved as the default (survives restarts); the `PI_WEIXIN_MODEL` env var can override the default.

### Slash commands

| Command | Description |
|---|---|
| `/help` | show help |
| `/status` | service status (version / account / model / workspace / uptime / sessions) |
| `/new` | start a new conversation (clears context) |
| `/model` | show current model |
| `/model list` | available models (only providers registered in models.json) |
| `/model <provider/modelId>` | switch model (applies to all in-flight sessions, saved as default) |
| `/skill` | available skills (with descriptions) |
| `/skill <name>` | next message is handled by that skill (pi reads its SKILL.md first) |
| `/mcp` | configured MCP servers (with launch commands) |
| `/mcp <name>` | next message uses tools of that MCP server |
| `/usage` | current conversation usage (messages / tool calls / tokens / cost / context) |
| `/stop` | stop the task in progress |
| `/ping` | liveness check |

> Command replies use markdown list formatting (WeChat renders markdown; a single newline is folded into a space, only list items are hard breaks).

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

CI: GitHub Actions automatically runs typecheck + test + build on push / PR (Node 22). On a push to `main`, if the tests pass and the version isn't published yet, it auto-publishes to npm.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| node.exe console pops up at startup | Use the built-in daemon or PM2 fork mode + the bin wrapper (the default); don't launch directly via the tsx CLI (it spawns an extra child process without `windowsHide`) |
| Background session expired, no messages | Background mode can't scan; the log tells you to run `pi-weixin-bridge login` in a terminal and re-scan — the service resumes automatically after scanning (the old PM2 flow used to hang waiting on stdin; fixed in 1.4.0) |
| Custom save path not taking effect | Paths are written to `~/.pi-weixin-bridge/config.json` (generated by the install wizard); at runtime the `PI_WEIXIN_STATE_DIR`/`PI_WEIXIN_WORKSPACE` env vars take priority over config.json. After changing, run `daemon restart` |
| Linux `daemon install-boot` says systemd unavailable | WSL has systemd disabled (needs `wsl --update` + systemd as PID 1); run `daemon start` manually instead |
| State dir / credentials permissions | On POSIX the state dir is auto-tightened to `700` and the account file to `600`; if the directory's owner is not the current user the chmod is silently skipped — check directory ownership |
| You send an image but pi says it "can't see it" | pi's global `images.blockImages` being true strips images before they reach the model; set it to false (`~/.pi/agent/settings.json`) |
| "Session expired" / asked to re-scan | errcode -14; run `pi-weixin-bridge login` to re-scan |
| Messages processed twice / conflicts | Don't run multiple instances polling getUpdates for the same WeChat account; make sure only one service is running |
| gh / npx network timeout | github.com connectivity fluctuation; configure a proxy (`HTTPS_PROXY`) and retry |

## License

MIT
