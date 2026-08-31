import type { StyleProfile } from '../shared/schemas/style-profile'
import { visionEvidenceSchema, type VisionEvidence } from '../shared/schemas/vision-evidence'
import { apiConnection, getExtensionSettings, type ExtensionSettings } from '../shared/local-api'
import { saveCapturedImages } from './capture-download'
import { captureVisualEvidence, type CapturedVisionImage } from './vision-capture'

export {
  DEFAULT_API_BASE,
  DEFAULT_API_SECRET,
  isLocalApiBase,
  resolveApiBase,
} from '../shared/local-api'

type Settings = ExtensionSettings

interface SseEvent {
  event: string
  data: unknown
}

class PipelineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoverable = true,
  ) {
    super(message)
  }
}

const apiLog = (...args: unknown[]) => console.info('[StyleLens][API]', ...args)
const apiWarn = (...args: unknown[]) => console.warn('[StyleLens][API]', ...args)
const apiError = (...args: unknown[]) => console.error('[StyleLens][API]', ...args)

async function getSettings(): Promise<Settings> {
  return getExtensionSettings()
}

function parseSseEvent(raw: string): SseEvent | null {
  const lines = raw.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  const data = dataLines.join('\n')
  try {
    return { event, data: JSON.parse(data) as unknown }
  } catch {
    return { event, data }
  }
}

function eventRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringField(value: unknown, key: string): string | undefined {
  const field = eventRecord(value)[key]
  return typeof field === 'string' ? field : undefined
}

function errorFromHttp(status: number, body: unknown, fallback: string): PipelineError {
  const error = eventRecord(body).error
  const code = stringField(error, 'code') ?? 'E_BACKEND_UNAVAILABLE'
  const message = stringField(error, 'message') ?? fallback
  return new PipelineError(code, message, status !== 401 && status !== 403)
}

function visionTask(profile: StyleProfile): string {
  const target = profile.target
  const inventory: string[] = []
  const walk = (nodes: StyleProfile['componentTree'], depth = 0) => {
    if (!nodes || depth > 5 || inventory.length >= 96) return
    for (const [index, node] of nodes.entries()) {
      if (inventory.length >= 96) break
      const path = `${'  '.repeat(depth)}root${depth > 0 ? ` > child[${(node.childIndex ?? index) + 1}]` : ''}`
      const geometry = node.rect
        ? ` rect=${node.rect.width}x${node.rect.height}@${node.rect.x},${node.rect.y}`
        : ''
      const state = node.state
        ? ` state=${Object.entries(node.state)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}:${value}`)
            .join(',')}`
        : ''
      const control = node.control
        ? ` control=${node.control.kind}${node.control.type ? ` type=${node.control.type}` : ''}${node.control.placeholder ? ` placeholder=${node.control.placeholder}` : ''}${node.control.valuePresent !== undefined ? ` valuePresent=${node.control.valuePresent}` : ''}`
        : ''
      const computed = node.computed
        ? Object.entries(node.computed)
            .filter(([property]) =>
              [
                'display',
                'position',
                'width',
                'height',
                'padding-top',
                'padding-right',
                'padding-bottom',
                'padding-left',
                'gap',
                'flex-direction',
                'justify-content',
                'align-items',
                'font-size',
                'font-weight',
                'line-height',
                'color',
                'background-color',
                'background-image',
                'background-clip',
                'border-top-width',
                'border-right-width',
                'border-bottom-width',
                'border-left-width',
                'border-top-color',
                'border-right-color',
                'border-bottom-color',
                'border-left-color',
                'border-top-left-radius',
                'border-top-right-radius',
                'border-bottom-right-radius',
                'border-bottom-left-radius',
                'box-shadow',
                'opacity',
                'transform',
                'clip-path',
                'mask-image',
                'z-index',
              ].includes(property),
            )
            .slice(0, 16)
            .map(([property, value]) => `${property}=${value}`)
            .join(';')
        : ''
      const pseudo = node.pseudoElements?.length
        ? ` pseudo=${node.pseudoElements.map((item) => `${item.pseudo}:${item.inferredPurpose ?? 'visible'}`).join(',')}`
        : ''
      inventory.push(
        `${path}: <${node.tagName}> role=${node.roleGuess}${node.interactive ? ' interactive' : ''}${node.visibilityState && node.visibilityState !== 'visible' ? ` visibility=${node.visibilityState}` : ''}${node.effectiveOpacity !== undefined ? ` effectiveOpacity=${node.effectiveOpacity}` : ''}${node.actionHint ? ` hint=${node.actionHint}` : ''}${geometry}${state}${control}${computed ? ` computed=${computed}` : ''}${pseudo}${node.textContent ? ` text=${node.textContent}` : ''}`,
      )
      walk(node.children, depth + 1)
    }
  }
  walk(profile.componentTree)
  return [
    `Analyze the selected ${profile.analysisScope === 'component' ? 'complete composite' : ''} <${target.tagName}> UI component for reconstruction.`,
    `The images are labeled target and context crops. The target crop is the selected analysis root with a small visual margin; the context crop includes nearby layout. Use target for internal paint and context for boundary, grouping, shadow, clipping, and placement. Crop coordinates are viewport CSS pixels; report visible-region bounds relative to the named crop.`,
    'Use the browser-observed component inventory and layout context to describe grouping and control relationships. Check for DOM-vision conflicts; browser geometry is authoritative for measured coordinates.',
    'For each DOM consistency check, return property, browserValue, visualValue, resolution, status, and evidence. Use the exact browser value only when it appears in the supplied inventory; use null for unavailable sides. Do not encode a consistency check as prose-only claim text.',
    inventory.length > 0 ? `Browser-observed component inventory:\n${inventory.join('\n')}` : '',
    'Return visibleRegions for each visible child region with name, role, description, approximate bounds relative to the crop, relation to siblings, confidence, and evidence. Include regions that are visible but absent from the DOM inventory as unknown/missing evidence.',
    'Also output an "appearance" object with: palette (dominant colors as hex/rgb strings),',
    'surfaceTreatment (dark/light/glass/gradient surface description),',
    'appearanceDescription (one paragraph describing the overall look),',
    'and subcomponents (each visible sub-component with a name and visual description).',
  ]
    .filter(Boolean)
    .join(' ')
}

/** All active visual and synthesis work for a tab shares one cancellation signal. */
const activeStreams = new Map<number, AbortController>()

export function cancelPrompt(tabId: number) {
  const controller = activeStreams.get(tabId)
  if (!controller) {
    apiLog('request:cancel:ignored', { tabId, reason: 'no-active-request' })
    return
  }
  activeStreams.delete(tabId)
  controller.abort()
  apiLog('request:cancelled', { tabId })
}

async function setCaptureOverlay(
  tabId: number,
  type: 'VISION_CAPTURE_PREPARE' | 'VISION_CAPTURE_RESTORE',
) {
  const response = await chrome.tabs.sendMessage(tabId, { type })
  if (eventRecord(response).ok !== true) {
    throw new PipelineError(
      'E_VISION_CAPTURE_FAILED',
      `Unable to ${type === 'VISION_CAPTURE_PREPARE' ? 'hide' : 'restore'} the extension overlay`,
    )
  }
}

async function collectVisionImages(
  profile: StyleProfile,
  tabId: number,
  windowId: number | undefined,
  traceId: string,
): Promise<CapturedVisionImage[]> {
  if (windowId === undefined) {
    throw new PipelineError('E_VISION_CAPTURE_FAILED', 'Selected tab has no browser window context')
  }

  apiLog('vision:capture:start', {
    traceId,
    tabId,
    target: profile.target.tagName,
    rect: { width: profile.target.rect.width, height: profile.target.rect.height },
  })

  let prepared = false
  try {
    await setCaptureOverlay(tabId, 'VISION_CAPTURE_PREPARE')
    prepared = true
    const captures = await captureVisualEvidence(
      { windowId },
      profile.target.rect,
      profile.responsive.viewport,
    )
    if (captures.length === 0) {
      throw new PipelineError('E_VISION_CAPTURE_FAILED', 'No visual evidence crops were produced')
    }
    try {
      await saveCapturedImages(captures, traceId)
    } catch (error: unknown) {
      // Capture persistence is optional and must never block analysis.
      apiWarn('vision:capture-download-failed', {
        traceId,
        tabId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    apiLog('vision:capture:complete', {
      traceId,
      tabId,
      imageCount: captures.length,
      crops: captures.map(({ kind, width, height, crop }) => ({
        kind,
        width,
        height,
        crop,
      })),
    })
    return captures
  } catch (error) {
    if (error instanceof PipelineError) throw error
    throw new PipelineError(
      'E_VISION_CAPTURE_FAILED',
      `Unable to capture selected UI: ${(error as Error)?.message ?? 'unknown error'}`,
    )
  } finally {
    if (prepared) {
      await setCaptureOverlay(tabId, 'VISION_CAPTURE_RESTORE').catch((error: unknown) => {
        apiWarn('vision:capture:restore-failed', {
          traceId,
          tabId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }
}

async function requestVisionEvidence(
  profile: StyleProfile,
  tabId: number,
  windowId: number | undefined,
  base: string,
  secret: string,
  traceId: string,
  signal: AbortSignal,
): Promise<{
  evidence?: VisionEvidence
  images: CapturedVisionImage[]
  unavailableReason?: string
}> {
  const images = await collectVisionImages(profile, tabId, windowId, traceId)
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError')

  const requestUrl = `${base}/api/prompt/vision/stream`
  apiLog('vision:request:start', { traceId, tabId, url: requestUrl, imageCount: images.length })

  let response: Response
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
        'x-trace-id': traceId,
      },
      body: JSON.stringify({
        task: `${visionTask(profile)}\nImage order: ${images.map((image, index) => `${index + 1}=${image.kind}`).join(', ')}.`,
        // Preserve crop labels and CSS coordinates through the Vision boundary.
        images,
        imageDetail: 'high',
      }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new PipelineError(
      'E_VISION_BACKEND_UNAVAILABLE',
      `Vision API unreachable (${requestUrl}): ${(error as Error)?.message ?? 'unknown error'}`,
    )
  }

  apiLog('vision:request:response', {
    traceId,
    tabId,
    status: response.status,
    contentType: response.headers.get('content-type'),
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (response.ok && !contentType.toLowerCase().includes('text/event-stream')) {
    const body = await response.json().catch(() => null)
    const record = eventRecord(body)
    if (record.available === false) {
      return {
        images,
        unavailableReason: stringField(body, 'reason') ?? 'Vision capability is unavailable',
      }
    }
    throw new PipelineError(
      'E_VISION_INVALID_RESULT',
      'Vision API returned a non-stream response without an availability fallback',
      false,
    )
  }
  if (!response.ok || !response.body) {
    throw errorFromHttp(
      response.status,
      await response.json().catch(() => null),
      `Vision API responded ${response.status}`,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: VisionEvidence | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = parseSseEvent(frame)
      if (!event) continue
      if (event.event === 'vision_result') {
        const parsed = visionEvidenceSchema.safeParse(event.data)
        if (!parsed.success) {
          throw new PipelineError(
            'E_VISION_INVALID_RESULT',
            'Vision API returned an invalid structured result',
            false,
          )
        }
        result = parsed.data
      } else if (event.event === 'vision_error') {
        throw new PipelineError(
          stringField(event.data, 'code') ?? 'E_VISION_PROVIDER_ERROR',
          stringField(event.data, 'message') ?? 'Vision model failed to analyze the selected UI',
          eventRecord(event.data).recoverable !== false,
        )
      } else if (event.event === 'vision_complete') {
        if (!result) {
          throw new PipelineError(
            'E_VISION_INVALID_RESULT',
            'Vision stream completed without structured evidence',
            false,
          )
        }
        apiLog('vision:complete', {
          traceId,
          tabId,
          source: result.source,
          boundary: result.analysis.componentBoundary.kind,
          confidence: result.analysis.overallConfidence,
        })
        return { evidence: result, images }
      }
    }
  }

  throw new PipelineError('E_VISION_SSE_DISCONNECT', 'Vision API stream closed before completion')
}

/**
 * Preferred pipeline: capture -> Vision Slot -> structured evidence merge ->
 * Agent Slot. A Vision failure degrades to an explicitly warned DOM-only
 * Agent request so a structural reconstruction remains useful.
 */
export async function requestPrompt(
  profile: StyleProfile,
  tabId: number,
  windowId?: number,
): Promise<void> {
  const controller = new AbortController()
  activeStreams.set(tabId, controller)
  const traceId = crypto.randomUUID()
  const cleanup = () => {
    if (activeStreams.get(tabId) === controller) activeStreams.delete(tabId)
  }
  // Chrome does not guarantee ordering for multiple independent sendMessage
  // calls. Keep the lifecycle marker ahead of reasoning/content chunks so the
  // overlay can switch to its streaming view before the first token arrives.
  let bridgeQueue = Promise.resolve()
  const send = (msg: unknown) => {
    bridgeQueue = bridgeQueue.then(async () => {
      try {
        await chrome.tabs.sendMessage(tabId, msg)
      } catch (error: unknown) {
        apiWarn('bridge:send-failed', {
          traceId,
          tabId,
          messageType: (msg as { type?: string })?.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
    return bridgeQueue
  }
  const fail = (code: string, message: string, recoverable = true) => {
    const tracedMessage = `${message} [trace: ${traceId}]`
    apiError('request:failed', { traceId, tabId, code, message })
    send({ type: 'ANALYSIS_ERROR', payload: { code, message: tracedMessage, recoverable } })
  }

  try {
    const settings = await getSettings()
    const { base, secret } = apiConnection(settings)
    let visionEvidence: VisionEvidence | undefined
    let visionImages: CapturedVisionImage[] = []
    let visionWarning: string | undefined
    try {
      const visionRun = await requestVisionEvidence(
        profile,
        tabId,
        windowId,
        base,
        secret,
        traceId,
        controller.signal,
      )
      visionEvidence = visionRun.evidence
      visionImages = visionRun.images
      visionWarning = visionRun.unavailableReason
    } catch (error) {
      if (controller.signal.aborted) return
      visionWarning = error instanceof Error ? error.message : String(error)
      apiWarn('vision:degraded-to-dom-only', { traceId, tabId, reason: visionWarning })
    }
    if (controller.signal.aborted) return

    const enrichedProfile: StyleProfile = {
      ...profile,
      ...(visionEvidence ? { visionEvidence } : {}),
      warnings: [
        ...(profile.warnings ?? []),
        ...(visionWarning
          ? [
              {
                code: 'PROVIDER_WARNING' as const,
                message: `Vision unavailable: ${visionWarning}`,
                severity: 'warning' as const,
              },
            ]
          : []),
      ],
    }
    const requestUrl = `${base}/api/prompt/stream`
    apiLog('agent:request:start', {
      traceId,
      tabId,
      url: requestUrl,
      target: profile.target.tagName,
      factCount: profile.facts.length,
      visionSource: visionEvidence?.source ?? 'unavailable',
    })
    send({ type: 'PROMPT_START' })

    let response: Response
    try {
      response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
          'x-trace-id': traceId,
        },
        body: JSON.stringify({
          profile: enrichedProfile,
          images: visionImages,
          options: { targetFramework: 'agnostic', language: 'en', detail: 'balanced' },
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      throw new PipelineError(
        'E_BACKEND_UNAVAILABLE',
        `Agent API unreachable (${requestUrl}): ${(error as Error)?.message ?? 'unknown error'}`,
      )
    }

    apiLog('agent:request:response', {
      traceId,
      tabId,
      status: response.status,
      contentType: response.headers.get('content-type'),
    })
    if (!response.ok || !response.body) {
      throw errorFromHttp(
        response.status,
        await response.json().catch(() => null),
        `Agent API responded ${response.status}`,
      )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let chunkCount = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const event = parseSseEvent(frame)
        if (!event) continue
        if (event.event === 'prompt_chunk') {
          const text = stringField(event.data, 'text')
          if (text) {
            chunkCount += 1
            send({ type: 'PROMPT_CHUNK', payload: { text } })
          }
        } else if (event.event === 'prompt_reasoning_chunk') {
          const text = stringField(event.data, 'text')
          if (text) send({ type: 'PROMPT_REASONING_CHUNK', payload: { text } })
        } else if (event.event === 'prompt_complete') {
          apiLog('agent:complete', { traceId, tabId, chunkCount })
          // Do not let requestPrompt resolve before the ordered bridge queue
          // has delivered the final content and completion marker.
          await send({ type: 'PROMPT_COMPLETE' })
          return
        } else if (event.event === 'prompt_error') {
          throw new PipelineError(
            stringField(event.data, 'code') ?? 'E_PROVIDER_STREAM_ERROR',
            stringField(event.data, 'message') ??
              'Agent model failed to generate a reconstruction prompt',
          )
        }
      }
    }
    throw new PipelineError('E_SSE_DISCONNECT', 'Agent API stream closed before completion')
  } catch (error) {
    if (controller.signal.aborted) {
      apiLog('request:aborted', { traceId, tabId })
      return
    }
    const pipelineError =
      error instanceof PipelineError
        ? error
        : new PipelineError('E_ANALYSIS_PIPELINE', (error as Error)?.message ?? 'Analysis failed')
    fail(pipelineError.code, pipelineError.message, pipelineError.recoverable)
  } finally {
    cleanup()
  }
}
