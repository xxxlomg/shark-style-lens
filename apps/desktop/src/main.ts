import './style.css'
import { invoke } from '@tauri-apps/api/core'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'

const productIcon = new URL('../../extension/public/stylelens-icon-128.png', import.meta.url).href
const giteeLogo = new URL('./assets/gitee-logo.png', import.meta.url).href
const githubLogo = new URL('./assets/github-logo.svg', import.meta.url).href

const DEFAULT_API_PORT = 3001
const API_SECRET = 'stylelens-dev'
const GITEE_URL = 'https://gitee.com/xxxlomg/shark-style-lens.git'
const GITHUB_URL = 'https://github.com/xxxlomg/shark-style-lens'
const WINDOW_WIDTH = 520
const WINDOW_MIN_HEIGHT = 440

interface PublicConfig {
  configPath: string
  configured: boolean
  provider: 'deepseek'
  apiKeyConfigured: boolean
  apiKeyHint: string | null
  baseUrl: string
  agentModel: string
  visionModel: string
  thinkingEnabled: boolean
  reasoningEffort: 'low' | 'high' | 'max'
}

interface ApiError {
  error?: { code?: string; message?: string }
}

const appRoot = document.querySelector<HTMLDivElement>('#app')
if (!appRoot) throw new Error('StyleLens desktop root is missing')
const app = appRoot
const isTauriRuntime = Boolean(
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
)
const currentWindow = isTauriRuntime ? getCurrentWindow() : null

let config: PublicConfig | null = null
let busy = false
let apiPort = DEFAULT_API_PORT
let resizeFrame: number | null = null
let preserveAdvancedSettingsOpen = false
let configLoadPromise: Promise<void> | null = null

function apiBase(): string {
  return `http://127.0.0.1:${apiPort}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function stateCapsule(): string {
  const configured = config?.apiKeyConfigured ?? false
  return `
    <span class="state-capsule ${configured ? 'is-ready' : 'is-pending'}">
      <span class="state-led" aria-hidden="true"></span>
      <span>${configured ? 'AI 已连接' : '需要配置'}</span>
    </span>`
}

function brandMarkup() {
  return `
    <div class="brand-row">
      <div class="brand-mark" aria-hidden="true"><img src="${productIcon}" alt="" /></div>
      <div class="brand-copy">
        <span class="brand-name">StyleLens</span>
        <span class="brand-subtitle">by xxxlomg</span>
      </div>
      <div class="repository-links" aria-label="开源仓库">
        <a class="repository-link" data-repository-link="gitee" href="${GITEE_URL}" target="_blank" rel="noreferrer" title="打开 Gitee 源码">
          <img src="${giteeLogo}" alt="Gitee" />
        </a>
        <a class="repository-link github-link" data-repository-link="github" href="${GITHUB_URL}" target="_blank" rel="noreferrer" title="打开 GitHub 源码">
          <img src="${githubLogo}" alt="GitHub" />
        </a>
      </div>
    </div>`
}

function windowControlsMarkup() {
  return `
    <div class="window-controls" aria-label="窗口控制">
      <button id="minimize-window" class="window-control" type="button" aria-label="收起到托盘">−</button>
      <button id="close-window" class="window-control window-control-close" type="button" aria-label="关闭窗口并驻留托盘">×</button>
    </div>`
}

async function hideWindowToTray() {
  if (!currentWindow) return
  try {
    await currentWindow.hide()
  } catch (error) {
    // A minimized window is still excluded from the taskbar by skipTaskbar.
    try {
      await currentWindow.minimize()
    } catch {
      console.error('[StyleLens] Unable to hide the desktop window', error)
    }
  }
}

function bindWindowControls() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.window-control')) {
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      void hideWindowToTray()
    })
  }

  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-repository-link]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const repository = link.dataset.repositoryLink
      const isGitHub = repository === 'github'
      const url = isGitHub ? GITHUB_URL : GITEE_URL
      const command = isGitHub ? 'open_github_page' : 'open_gitee_page'
      void invoke(command).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer')
      })
    })
  }

  document.querySelector<HTMLElement>('[data-tauri-drag-region]')?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, input, summary, a')) return
    if (!currentWindow) return
    void currentWindow.startDragging().catch(() => undefined)
  })
}

function scheduleWindowResize() {
  if (!currentWindow) return
  if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = null
    const height = Math.max(WINDOW_MIN_HEIGHT, Math.ceil(document.documentElement.scrollHeight))
    void currentWindow.setSize(new LogicalSize(WINDOW_WIDTH, height)).catch(() => undefined)
  })
}

function bindAdvancedSettings() {
  document.querySelector<HTMLDetailsElement>('#advanced-settings')?.addEventListener('toggle', scheduleWindowResize)
  scheduleWindowResize()
}

function render(state: 'loading' | 'ready' | 'error', message = '') {
  if (state === 'loading') {
    app.innerHTML = `
      <main class="shell shell-loading">
        <section class="status-card" aria-live="polite">
          <header class="window-header" data-tauri-drag-region>${brandMarkup()}${windowControlsMarkup()}</header>
          <div class="status-card-copy">
            <p class="eyebrow">LOCAL ENGINE</p>
            <h1>正在启动</h1>
            <p class="muted">正在连接本机服务，请稍候。</p>
          </div>
        </section>
        <div class="loader" aria-label="Loading"></div>
      </main>`
    bindWindowControls()
    scheduleWindowResize()
    return
  }

  if (state === 'error' || !config) {
    app.innerHTML = `
      <main class="shell shell-error">
        <section class="status-card">
          <header class="window-header" data-tauri-drag-region>${brandMarkup()}${windowControlsMarkup()}</header>
          <div class="status-card-copy">
            <p class="eyebrow">LOCAL ENGINE</p>
            <h1>本地服务暂时没有响应</h1>
            <p class="muted">${escapeHtml(message || '请确认程序没有被安全软件拦截，然后重新尝试。')}</p>
            <button class="primary" id="retry" type="button"><span>重新连接</span><span aria-hidden="true">→</span></button>
          </div>
        </section>
      </main>`
    bindWindowControls()
    scheduleWindowResize()
    document.querySelector<HTMLButtonElement>('#retry')?.addEventListener('click', () => void loadConfig())
    return
  }

  const keyHint = config.apiKeyConfigured && config.apiKeyHint
    ? `当前已保存 ${escapeHtml(config.apiKeyHint)}，留空即可保持不变。`
    : '仅保存在本机配置中，不会进入浏览器扩展。'

  app.innerHTML = `
    <main class="shell">
      <section class="setup-card">
        <header class="window-header" data-tauri-drag-region>
          ${brandMarkup()}
          ${windowControlsMarkup()}
        </header>
        <form id="settings-form" class="setup-form">
          <div class="section-heading">
            <div>
              <p class="eyebrow">PROVIDER</p>
              <h1>连接 DeepSeek</h1>
            </div>
            ${stateCapsule()}
          </div>
          <div class="field api-key-field">
            <label for="api-key">API Key</label>
            <span class="input-shell">
              <input id="api-key" type="password" autocomplete="off" placeholder="sk-..." aria-describedby="api-key-hint" />
              <button id="toggle-key" class="input-action" type="button" aria-label="显示 API Key" aria-controls="api-key">显示</button>
            </span>
            <small id="api-key-hint">${keyHint}</small>
          </div>
          <details id="advanced-settings" class="advanced-settings" ${preserveAdvancedSettingsOpen || config.thinkingEnabled ? 'open' : ''}>
            <summary><span>高级设置</span><span class="summary-hint">思考模式</span></summary>
            <div class="advanced-content">
               <label class="check-field"><input id="thinking-mode" type="checkbox" ${config.thinkingEnabled ? 'checked' : ''} /><span>启用 DeepSeek 思考模式</span></label>
               <label class="field compact-field"><span>思考强度</span><select id="reasoning-effort" ${config.thinkingEnabled ? '' : 'disabled'}>
                 <option value="low" ${config.reasoningEffort === 'low' ? 'selected' : ''}>Low</option>
                 <option value="high" ${config.reasoningEffort === 'high' ? 'selected' : ''}>High</option>
                 <option value="max" ${config.reasoningEffort === 'max' ? 'selected' : ''}>Max</option>
               </select></label>
               <div class="connection-meta" aria-label="模型与本机服务信息">
                <div><span>Agent</span><b>${escapeHtml(config.agentModel)}</b></div>
                <div><span>Vision</span><b>${escapeHtml(config.visionModel)}</b></div>
                <div><span>Endpoint</span><b>127.0.0.1:${apiPort}</b></div>
              </div>
            </div>
          </details>
          <div class="actions">
            <button class="primary" id="save" type="submit"><span>保存并继续</span><span aria-hidden="true">→</span></button>
            <span id="save-status" class="form-status" role="status" aria-live="polite"></span>
          </div>
        </form>
        <section class="extension-row" aria-labelledby="extension-heading">
          <div class="extension-mark" aria-hidden="true">↗</div>
          <div class="extension-copy">
            <h2 id="extension-heading">安装浏览器扩展</h2>
            <p id="download-status" role="status" aria-live="polite">打开安装页，在 Chrome 中加载 ZIP。</p>
          </div>
          <button class="extension-action" id="open-extension-download" type="button"><span>打开</span></button>
        </section>
      </section>
    </main>`

  bindWindowControls()
  bindAdvancedSettings()
  document.querySelector<HTMLInputElement>('#thinking-mode')?.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement
    const effort = document.querySelector<HTMLSelectElement>('#reasoning-effort')
    if (effort) effort.disabled = !input.checked
  })
  document.querySelector<HTMLFormElement>('#settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    void saveConfig()
  })
  document.querySelector<HTMLButtonElement>('#open-extension-download')?.addEventListener('click', () => {
    void openExtensionInstallPage()
  })
  document.querySelector<HTMLButtonElement>('#toggle-key')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement
    const input = document.querySelector<HTMLInputElement>('#api-key')
    if (!input) return
    const isHidden = input.type === 'password'
    input.type = isHidden ? 'text' : 'password'
    button.textContent = isHidden ? '隐藏' : '显示'
    button.setAttribute('aria-label', `${isHidden ? '隐藏' : '显示'} API Key`)
  })
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${API_SECRET}`, ...(init.headers ?? {}) },
  })
  const body = (await response.json().catch(() => null)) as T & ApiError | null
  if (!response.ok) throw new Error(body?.error?.message ?? `请求失败（${response.status}）`)
  return body as T
}

async function loadConfig() {
  if (configLoadPromise) return configLoadPromise

  configLoadPromise = loadConfigOnce()
  try {
    await configLoadPromise
  } finally {
    configLoadPromise = null
  }
}

async function loadConfigOnce() {
  render('loading')
  let lastError = '本地 API 未启动'
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      try {
        const port = await invoke<number>('get_api_port')
        if (Number.isInteger(port) && port >= 1 && port <= 65535) apiPort = port
      } catch {
        // Browser-only Vite preview keeps the development fallback port.
      }
      config = await apiRequest<PublicConfig>('/api/config')
      if (typeof config.thinkingEnabled !== 'boolean' || !config.reasoningEffort) {
        throw new Error('本地服务版本过旧，请重新构建并启动 StyleLens。')
      }
      render('ready')
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await new Promise((resolve) => window.setTimeout(resolve, 300))
    }
  }
  render('error', lastError)
}

async function saveConfig() {
  if (!config || busy) return
  const saveButton = document.querySelector<HTMLButtonElement>('#save')
  const status = document.querySelector<HTMLSpanElement>('#save-status')
  const key = document.querySelector<HTMLInputElement>('#api-key')?.value.trim() ?? ''
  const thinkingEnabled = document.querySelector<HTMLInputElement>('#thinking-mode')?.checked ?? false
  const reasoningEffort = document.querySelector<HTMLSelectElement>('#reasoning-effort')?.value ?? 'high'
  preserveAdvancedSettingsOpen = document.querySelector<HTMLDetailsElement>('#advanced-settings')?.open ?? false
  busy = true
  if (saveButton) saveButton.disabled = true
  if (status) status.textContent = '保存中...'
  try {
    const patch: Record<string, string | boolean> = { thinkingEnabled, reasoningEffort }
    if (key) patch.apiKey = key
    const savedConfig = await apiRequest<PublicConfig>('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (
      savedConfig.thinkingEnabled !== thinkingEnabled ||
      savedConfig.reasoningEffort !== reasoningEffort
    ) {
      throw new Error('本地服务未确认思考模式设置，请重新构建并启动 StyleLens。')
    }
    config = savedConfig
    render('ready')
    preserveAdvancedSettingsOpen = false
    const nextStatus = document.querySelector<HTMLSpanElement>('#save-status')
    if (nextStatus) nextStatus.textContent = '已保存'
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : '保存失败'
  } finally {
    busy = false
    if (saveButton) saveButton.disabled = false
  }
}

async function openExtensionInstallPage() {
  const downloadButton = document.querySelector<HTMLButtonElement>('#open-extension-download')
  const status = document.querySelector<HTMLParagraphElement>('#download-status')
  if (downloadButton) downloadButton.disabled = true
  if (status) status.textContent = '正在打开浏览器...'

  try {
    await invoke('open_extension_install_page')
    if (status) status.textContent = '已打开安装页，请在浏览器中下载 ZIP。'
  } catch {
    const opened = window.open(`${apiBase()}/`, '_blank', 'noopener,noreferrer')
    if (status) {
      status.textContent = opened
        ? '已打开安装页，请在浏览器中下载 ZIP。'
        : `请在浏览器中访问 ${apiBase()}/。`
    }
  } finally {
    if (downloadButton) downloadButton.disabled = false
  }
}

void loadConfig()
