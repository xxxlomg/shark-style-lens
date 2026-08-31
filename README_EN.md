# StyleLens

<p align="center">
  <img src="apps/extension/public/stylelens-icon.svg" width="48" height="48" alt="StyleLens">
</p>

<p align="center"><strong>Select web UI and hand it to AI for reconstruction.</strong></p>

<p align="center">
  <a href="README.md">简体中文</a> |
  <a href="https://gitee.com/xxxlomg/shark-style-lens">Gitee</a>
</p>

StyleLens is a local-first Chrome Manifest V3 extension. Select an element on a web page and it analyzes the DOM, CSS, layout, and visual evidence to produce a high-fidelity UI reconstruction prompt for AI coding tools.

## What It Does

- Select a single element or expand the selection into a contextual component.
- Inspect the DOM subtree, semantic roles, computed styles, layout relationships, themes, and interaction clues.
- Capture the visible target region to reduce noise from surrounding page content.
- Generate structured visual evidence with a Vision model, then compile a reconstruction prompt with an Agent model.
- Stream, copy, and regenerate the prompt in the extension overlay.
- Keep model configuration in a local API service so cloud API keys never enter the extension bundle.

## How It Works

```text
Selected web element
  -> DOM / CSS / layout analysis
  -> Target-region screenshot
  -> Vision: structured visual evidence
  -> Agent: streamed reconstruction prompt
  -> Extension overlay: review and copy
```

A complete analysis normally has two model stages: Vision identifies visual characteristics, while the Agent combines the DOM Profile and visual evidence into the final prompt.

## Model Thinking Mode

The Agent supports an optional thinking mode. Enable it in the desktop configuration panel and choose `low`, `high`, or `max` reasoning effort. Reasoning content is streamed through the local SSE connection and shown in the Thinking section of the extension Prompt panel; the final prompt remains a separate, copyable output.

Thinking mode is disabled by default. It applies only to Agent prompt generation, not Vision structured analysis, which keeps the visual-evidence JSON stable. The setting is stored locally and is never written into the extension bundle.

## Project Structure

```text
apps/extension/  Chrome extension: selection, analysis, capture, and prompt overlay
apps/desktop/    Windows desktop configuration UI and API sidecar
services/api/    Local Hono API, SSE routes, and model providers
packages/        Shared types and API contracts
```

## Requirements

- Node.js 22+
- pnpm 9+
- Chrome or Chromium
- An optional DeepSeek API key; without one, local mock responses can be used for development

## Development Setup

From the repository root:

```powershell
pnpm install
Copy-Item services/api/.env.example services/api/.env
```

Edit `services/api/.env` and provide at least:

```dotenv
STYLELENS_API_SECRET=stylelens-dev
DEEPSEEK_API_KEY=your_deepseek_api_key
```

Start the local API:

```powershell
pnpm --filter @stylelens/api dev
```

In another terminal, build the extension:

```powershell
pnpm --filter @stylelens/extension build
```

Open `chrome://extensions`, enable Developer mode, choose “Load unpacked,” and select `apps/extension/dist`. Open a web page and press `Alt+Shift+S`, or click the extension icon, to start selecting.

The local API listens on `http://127.0.0.1:3001` by default and also serves a local page for downloading the extension ZIP.

## Windows Desktop App

The desktop app starts the local API sidecar and provides configuration for the API key and thinking mode. Its default configuration file is:

```text
%APPDATA%\shark\shark-style-lens\config.json
```

Run in development:

```powershell
pnpm desktop:dev
```

Build the installer:

```powershell
pnpm desktop:build
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Local API port |
| `STYLELENS_API_SECRET` | `stylelens-dev` | Shared secret between extension and local API |
| `DEEPSEEK_API_KEY` | empty | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API base URL |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | Agent model |
| `DEEPSEEK_VISION_MODEL` | `deepseek-v4-flash-vision-exp` | Vision model |
| `DEEPSEEK_VISION_TEMPERATURE` | `0.1` | Vision analysis temperature |
| `DEEPSEEK_VISION_IMAGE_DETAIL` | `auto` | Vision image detail level |
| `DEEPSEEK_VISION_MAX_IMAGES` | `4` | Maximum images accepted by the API per request |

Thinking mode is stored by the desktop app. It defaults to `thinkingEnabled=false`; the reasoning effort uses the configured project value.

## Privacy and Security

- The API listens only on the local loopback address by default.
- The DeepSeek API key is read only by the local API or desktop sidecar and is not bundled with the extension.
- Extension requests validate local API addresses and use a shared secret.
- Page content, screenshots, and prompts are not written to normal logs. Debug captures are saved only when explicitly enabled.
- Sensitive page fields are redacted before being sent to a model.

Never commit real API keys, personal configuration files, debug captures, build artifacts, or absolute local paths.

## Common Commands

```powershell
pnpm --filter @stylelens/extension typecheck
pnpm --filter @stylelens/extension lint
pnpm --filter @stylelens/api test
pnpm build
```

## Status

The project is currently under development. Repository: <https://gitee.com/xxxlomg/shark-style-lens>.
