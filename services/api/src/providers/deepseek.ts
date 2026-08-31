import { OpenAICompatibleProvider } from "./openai-compatible";
import type { ThinkingConfig } from "./model-config";

interface RequestLogContext {
  traceId?: string;
  slot?: "agent" | "vision";
}

const VISION_ANALYSIS_PROMPT = `
You are the dedicated visual evidence analyst for a UI reverse-engineering system.
Return only valid JSON. The JSON must contain exactly these top-level fields:
{
  "componentBoundary": { "kind": "string", "confidence": 0.0, "evidence": ["string"] },
  "visualGrouping": { "relationships": ["string"], "confidence": 0.0, "evidence": ["string"] },
  "visualSemantics": [{ "element": "string", "role": "string", "description": "string", "bounds": { "x": 0, "y": 0, "width": 0, "height": 0, "coordinateSpace": "target-crop" }, "relation": "string", "confidence": 0.0, "evidence": ["string"] }],
  "visibleRegions": [{ "name": "string", "role": "string", "description": "string", "bounds": { "x": 0, "y": 0, "width": 0, "height": 0, "coordinateSpace": "target-crop" }, "relation": "string", "nodeUid": "string", "confidence": 0.0, "evidence": ["string"] }],
  "stateChanges": [{ "state": "string", "changes": ["string"], "confidence": 0.0, "evidence": ["string"] }],
  "consistencyChecks": [{ "property": "string", "browserValue": "value or null", "visualValue": "value or null", "resolution": "consistent|browser-authoritative|visual-authoritative|preserve-both|unknown", "status": "consistent|conflict|unknown", "evidence": ["string"] }],
  "appearance": { "palette": ["string"], "surfaceTreatment": "string", "appearanceDescription": "string", "subcomponents": [{ "name": "string", "description": "string" }] },
  "overallConfidence": 0.0,
  "unknowns": ["string"]
}
Analyze the crop in this order: boundary, geometry, grouping, paint, typography, assets, controls/states, then DOM consistency.
The images are labeled by the task as target and context. Inspect target for internal paint and context for boundary, grouping, placement, shadow, clipping, and overlays. Report which image supports each observation.
For a composite input or dialog, explicitly account for the text area/input, toolbar, dropdown/select/menu trigger, prompt optimization button, send/submit button, icons, badges, dividers, status marks, and decorative pseudo-element-like lines whenever they are visible.
Use visibleRegions for each visible child region. Include approximate bounds relative to the crop, role, relation to siblings, confidence, and evidence references such as target-crop or node UIDs.
For every DOM consistency check, use a stable CSS or rendering property name (for example background-color, geometry, clipping, visual-grouping, or component-boundary). Copy browserValue only from the supplied browser inventory; put the screenshot observation in visualValue. Set resolution to the appropriate precedence rule. Do not put a prose sentence in place of these values. Use null when one side is not available, and use unknown status instead of guessing.
Use visualSemantics for uncertain meaning only; never claim a click action from appearance alone. Computed DOM geometry and native state are authoritative when supplied in the task context; do not override them with a visual estimate.
Do not infer hidden business behavior, source framework, class names, or exact asset identity. If a behavior/state/asset is not visible or captured, put it in unknowns. Separate visible observations from uncertain inferences. The response must be JSON.`;

/** DeepSeek Provider: streamed synthesis plus a complete JSON vision path. */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(
    apiKey: string,
    baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    temperature?: number,
    firstTokenTimeoutMs = 30_000,
    logContext?: RequestLogContext,
    thinking: ThinkingConfig = { enabled: false, reasoningEffort: "high" },
  ) {
    super({
      apiKey,
      baseUrl,
      model,
      label: "DeepSeek",
      firstTokenTimeoutMs,
      temperature,
      extraBody: {
        thinking: { type: thinking.enabled ? "enabled" : "disabled" },
        reasoning_effort: thinking.reasoningEffort,
      },
      visionPrompt: VISION_ANALYSIS_PROMPT,
      visionExtraBody: {
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 4096,
      },
      completionTimeoutMs: 60_000,
      logContext,
    });
  }
}
