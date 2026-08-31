import { getSaveCaptures } from '../shared/capture-settings'
import type { CapturedVisionImage } from './vision-capture'

function filenameTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

/** Persist the exact PNG crop through Chrome's normal Downloads UI when enabled. */
export async function saveCapturedImages(
  captures: CapturedVisionImage[],
  traceId: string,
): Promise<void> {
  if (!(await getSaveCaptures()) || !chrome.downloads?.download) return

  const timestamp = filenameTimestamp()
  await Promise.all(
    captures.map((capture, index) =>
      chrome.downloads.download({
        url: capture.dataUrl,
        filename: `stylelens/${timestamp}-${traceId}-${capture.kind}-${index + 1}.png`,
        saveAs: false,
        conflictAction: 'uniquify',
      }),
    ),
  )
}
