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
  analysisMode: 'template' | 'text' | 'multimodal'
  thinkingEnabled: boolean
  reasoningEffort: 'low' | 'high' | 'max'
}

interface HealthResponse {
  status: string
  configured: boolean
  connection?: {
    ok: boolean
    kind: 'template' | 'local' | 'deepseek'
    message: string
  }
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
let connectionBusy = false
let toastTimer: number | null = null

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

function aiStatusZone(): string {
  const configured = config?.apiKeyConfigured ?? false
  return `
    <div class="ai-status-zone">
      <button id="test-connection" class="connection-test-mini" type="button" aria-label="测试 AI 连通性" title="测试 AI 连通性">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9.8 14.2a4.6 4.6 0 0 0 6.1 1.4l2.9-2.9a4.6 4.6 0 0 0-6.5-6.5l-1.5 1.5" />
          <path d="M14.2 9.8a4.6 4.6 0 0 0-6.1-1.4l-2.9 2.9a4.6 4.6 0 0 0 6.5 6.5l1.5-1.5" />
        </svg>
      </button>
      <span class="state-capsule ${configured ? 'is-ready' : 'is-pending'}">
        <span class="state-led" aria-hidden="true"></span>
        <span>${configured ? 'AI 已连接' : '需要配置'}</span>
      </span>
    </div>`
}

function showToast(message: string, tone: 'success' | 'error' = 'success') {
  const toast = document.querySelector<HTMLDivElement>('#toast')
  if (!toast) return
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toast.textContent = message
  toast.className = `toast toast-${tone}`
  toast.hidden = false
  toastTimer = window.setTimeout(() => {
    toast.hidden = true
    toastTimer = null
  }, 2200)
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
            ${aiStatusZone()}
          </div>
          <div class="field api-key-field">
            <label for="api-key">API Key</label>
            <span class="input-shell">
              <input id="api-key" type="password" autocomplete="off" placeholder="sk-..." aria-describedby="api-key-hint" />
              <button id="toggle-key" class="input-action" type="button" aria-label="显示 API Key" aria-controls="api-key" aria-pressed="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <g class="eye-open">
                    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="2.8" />
                  </g>
                  <g class="eye-closed">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <path d="m1 1 22 22" />
                  </g>
                </svg>
                <span>显示</span>
              </button>
            </span>
            <small id="api-key-hint">${keyHint}</small>
          </div>
          <fieldset class="mode-field">
            <legend>分析模式</legend>
            <div class="mode-options">
              <label class="mode-option ${config.analysisMode === 'template' ? 'is-selected' : ''}">
                <input type="radio" name="analysis-mode" value="template" ${config.analysisMode === 'template' ? 'checked' : ''} />
                <span><b>模板模式</b><small>仅解析，不调用模型</small></span>
              </label>
              <label class="mode-option ${config.analysisMode === 'text' ? 'is-selected' : ''}">
                <input type="radio" name="analysis-mode" value="text" ${config.analysisMode === 'text' ? 'checked' : ''} />
                <span><b>文字模型</b><small>不发送截图</small></span>
              </label>
              <label class="mode-option ${config.analysisMode === 'multimodal' ? 'is-selected' : ''}">
                <input type="radio" name="analysis-mode" value="multimodal" ${config.analysisMode === 'multimodal' ? 'checked' : ''} />
                <span><b>视觉增强</b><small>Agent + Vision</small></span>
              </label>
            </div>
          </fieldset>
          <details id="advanced-settings" class="advanced-settings" ${preserveAdvancedSettingsOpen || (config.thinkingEnabled && config.analysisMode !== 'template') ? 'open' : ''}>
            <summary><span>高级设置</span><span class="summary-hint">思考模式</span></summary>
            <div class="advanced-content">
               <label class="check-field"><input id="thinking-mode" type="checkbox" ${config.thinkingEnabled && config.analysisMode !== 'template' ? 'checked' : ''} ${config.analysisMode === 'template' ? 'disabled' : ''} /><span>启用 DeepSeek 思考模式</span></label>
               <label class="field compact-field"><span>思考强度</span><select id="reasoning-effort" ${config.thinkingEnabled && config.analysisMode !== 'template' ? '' : 'disabled'}>
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
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    </main>`

  bindWindowControls()
  bindAdvancedSettings()
  const syncAnalysisModeUi = () => {
    const selected = document.querySelector<HTMLInputElement>('input[name="analysis-mode"]:checked')?.value
    const templateMode = selected === 'template'
    document.querySelectorAll<HTMLElement>('.mode-option').forEach((option) => {
      const input = option.querySelector<HTMLInputElement>('input')
      option.classList.toggle('is-selected', input?.checked === true)
    })
    const thinking = document.querySelector<HTMLInputElement>('#thinking-mode')
    const effort = document.querySelector<HTMLSelectElement>('#reasoning-effort')
    if (thinking) {
      thinking.disabled = templateMode
      if (templateMode) thinking.checked = false
    }
    if (effort) effort.disabled = templateMode || !(thinking?.checked ?? false)
  }
  document.querySelectorAll<HTMLInputElement>('input[name="analysis-mode"]').forEach((input) => {
    input.addEventListener('change', syncAnalysisModeUi)
  })
  document.querySelector<HTMLInputElement>('#thinking-mode')?.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement
    const effort = document.querySelector<HTMLSelectElement>('#reasoning-effort')
    if (effort) effort.disabled = input.disabled || !input.checked
  })
  syncAnalysisModeUi()
  document.querySelector<HTMLFormElement>('#settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    void saveConfig()
  })
  document.querySelector<HTMLButtonElement>('#open-extension-download')?.addEventListener('click', () => {
    void openExtensionInstallPage()
  })
  document.querySelector<HTMLButtonElement>('#test-connection')?.addEventListener('click', () => {
    void testConnection()
  })
  document.querySelector<HTMLButtonElement>('#toggle-key')?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const button = event.currentTarget as HTMLButtonElement
    const input = document.querySelector<HTMLInputElement>('#api-key')
    if (!input) return
    const isHidden = input.type === 'password'
    input.type = isHidden ? 'text' : 'password'
    button.classList.toggle('is-revealed', isHidden)
    const label = button.querySelector('span')
    if (label) label.textContent = isHidden ? '隐藏' : '显示'
    button.setAttribute('aria-label', `${isHidden ? '隐藏' : '显示'} API Key`)
    button.setAttribute('aria-pressed', String(isHidden))
    input.focus({ preventScroll: true })
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
      if (
        typeof config.thinkingEnabled !== 'boolean' ||
        !config.reasoningEffort ||
        !['template', 'text', 'multimodal'].includes(config.analysisMode)
      ) {
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
  const key = document.querySelector<HTMLInputElement>('#api-key')?.value.trim() ?? ''
  const analysisMode =
    document.querySelector<HTMLInputElement>('input[name="analysis-mode"]:checked')?.value ??
    'multimodal'
  const thinkingEnabled =
    analysisMode !== 'template' &&
    (document.querySelector<HTMLInputElement>('#thinking-mode')?.checked ?? false)
  const reasoningEffort = document.querySelector<HTMLSelectElement>('#reasoning-effort')?.value ?? 'high'
  preserveAdvancedSettingsOpen = document.querySelector<HTMLDetailsElement>('#advanced-settings')?.open ?? false
  busy = true
  if (saveButton) saveButton.disabled = true
  try {
    const patch: Record<string, string | boolean> = {
      analysisMode,
      thinkingEnabled,
      reasoningEffort,
    }
    if (key) patch.apiKey = key
    const savedConfig = await apiRequest<PublicConfig>('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (
      savedConfig.thinkingEnabled !== thinkingEnabled ||
      savedConfig.reasoningEffort !== reasoningEffort ||
      savedConfig.analysisMode !== analysisMode
    ) {
      throw new Error('本地服务未确认思考模式设置，请重新构建并启动 StyleLens。')
    }
    config = savedConfig
    preserveAdvancedSettingsOpen = false
    render('ready')
    showToast('已保存')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    busy = false
    if (saveButton) saveButton.disabled = false
  }
}

async function testConnection() {
  if (!config || connectionBusy) return
  const button = document.querySelector<HTMLButtonElement>('#test-connection')
  connectionBusy = true
  if (button) button.disabled = true
  try {
    const health = await apiRequest<HealthResponse>('/api/health?probe=1')
    const connection = health.connection
    if (connection?.ok) {
      showToast(connection.kind === 'template' ? '模板模式已就绪，无需 AI 连接' : 'AI 连接正常')
    } else if (health.configured) {
      showToast('本地服务正常，但 AI 端点未连通', 'error')
    } else {
      showToast('本地服务正常，请先配置 API Key', 'error')
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '连通性测试失败', 'error')
  } finally {
    connectionBusy = false
    if (button) button.disabled = false
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
