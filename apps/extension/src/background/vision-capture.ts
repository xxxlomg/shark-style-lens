import type { Rect, Size } from '../shared/schemas/style-profile'

const TARGET_PADDING_CSS_PX = 8
const CONTEXT_PADDING_CSS_PX = 160
const MAX_CROP_EDGE_PX = 2048

export type VisionCropKind = 'target' | 'context'

export interface VisionCropBox {
  kind: VisionCropKind
  coordinateSpace: 'viewport-css'
  left: number
  top: number
  width: number
  height: number
}

export interface CapturedVisionImage {
  kind: VisionCropKind
  dataUrl: string
  width: number
  height: number
  crop: VisionCropBox
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function cropBox(
  rect: Rect,
  viewport: Size,
  padding: number,
): Omit<VisionCropBox, 'kind' | 'coordinateSpace'> {
  const left = clamp(rect.left - padding, 0, viewport.width)
  const top = clamp(rect.top - padding, 0, viewport.height)
  const right = clamp(rect.right + padding, 0, viewport.width)
  const bottom = clamp(rect.bottom + padding, 0, viewport.height)
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

/** Capture the target and enough surrounding pixels to establish visual relationships. */
export function buildVisionCropBoxes(target: Rect, viewport: Size): VisionCropBox[] {
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error('Viewport must have positive dimensions before capturing visual evidence')
  }

  const targetCrop = cropBox(target, viewport, TARGET_PADDING_CSS_PX)
  const contextCrop = cropBox(target, viewport, CONTEXT_PADDING_CSS_PX)
  const crops: VisionCropBox[] = [
    { kind: 'target', ...targetCrop, coordinateSpace: 'viewport-css' },
  ]
  if (
    contextCrop.left !== targetCrop.left ||
    contextCrop.top !== targetCrop.top ||
    contextCrop.width !== targetCrop.width ||
    contextCrop.height !== targetCrop.height
  ) {
    crops.push({ kind: 'context', ...contextCrop, coordinateSpace: 'viewport-css' })
  }
  return crops
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    return `data:image/png;base64,${btoa(binary)}`
  })
}

async function cropPng(
  image: ImageBitmap,
  crop: VisionCropBox,
  viewport: Size,
): Promise<CapturedVisionImage> {
  const scaleX = image.width / viewport.width
  const scaleY = image.height / viewport.height
  const sourceLeft = Math.floor(crop.left * scaleX)
  const sourceTop = Math.floor(crop.top * scaleY)
  const sourceWidth = Math.max(1, Math.ceil(crop.width * scaleX))
  const sourceHeight = Math.max(1, Math.ceil(crop.height * scaleY))
  const scale = Math.min(1, MAX_CROP_EDGE_PX / Math.max(sourceWidth, sourceHeight))
  const outputWidth = Math.max(1, Math.round(sourceWidth * scale))
  const outputHeight = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = new OffscreenCanvas(outputWidth, outputHeight)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create a 2D canvas for visual evidence')

  context.drawImage(
    image,
    sourceLeft,
    sourceTop,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  )
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return {
    kind: crop.kind,
    dataUrl: await dataUrlFromBlob(blob),
    width: outputWidth,
    height: outputHeight,
    crop,
  }
}

/**
 * Captures the active tab after the content overlay is hidden, then crops only
 * the selected visual region. No full-page screenshot is retained or sent to
 * the model.
 */
export async function captureVisualEvidence(
  tab: Pick<chrome.tabs.Tab, 'windowId'>,
  target: Rect,
  viewport: Size,
): Promise<CapturedVisionImage[]> {
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  const image = await createImageBitmap(await (await fetch(screenshot)).blob())
  try {
    return await Promise.all(
      buildVisionCropBoxes(target, viewport).map((crop) => cropPng(image, crop, viewport)),
    )
  } finally {
    image.close()
  }
}
