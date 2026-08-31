import {
  visionAnalysisSchema,
  type VisionAnalysis,
} from "@stylelens/contracts";

export { visionAnalysisSchema };
export type { VisionAnalysis };

function removeJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseVisionAnalysis(value: string): VisionAnalysis {
  const json = JSON.parse(removeJsonFence(value)) as unknown;
  return visionAnalysisSchema.parse(json);
}
