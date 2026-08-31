import { z } from "zod";

export const boundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    coordinateSpace: z.enum([
      "target-crop",
      "context-crop",
      "viewport-css",
      "analysis-root-css",
    ]),
  })
  .optional();
export type Bounds = z.infer<typeof boundsSchema>;

const confidenceSchema = z.number().min(0).max(1);
const evidenceSchema = z.array(z.string().min(1)).min(1);

/**
 * The provider may still return `claim` for backward compatibility, but new
 * callers should identify the compared property and both observations.
 */
export const consistencyCheckSchema = z
  .object({
    property: z.string().min(1).optional(),
    claim: z.string().min(1).optional(),
    browserValue: z.unknown().optional(),
    visualValue: z.unknown().optional(),
    resolution: z
      .enum([
        "consistent",
        "browser-authoritative",
        "visual-authoritative",
        "preserve-both",
        "unknown",
      ])
      .optional(),
    status: z.enum(["consistent", "conflict", "unknown"]),
    evidence: evidenceSchema,
  })
  .superRefine((value, context) => {
    if (!value.property && !value.claim) {
      context.addIssue({
        code: "custom",
        message: "consistency check requires property or legacy claim",
        path: ["property"],
      });
    }
    if (value.status === "conflict") {
      if (!value.property) {
        context.addIssue({
          code: "custom",
          message: "conflict requires a machine-matchable property",
          path: ["property"],
        });
      }
      if (value.browserValue === undefined) {
        context.addIssue({
          code: "custom",
          message: "conflict requires browserValue or null",
          path: ["browserValue"],
        });
      }
      if (value.visualValue === undefined) {
        context.addIssue({
          code: "custom",
          message: "conflict requires visualValue or null",
          path: ["visualValue"],
        });
      }
      if (!value.resolution) {
        context.addIssue({
          code: "custom",
          message: "conflict requires an explicit resolution",
          path: ["resolution"],
        });
      }
    }
  });
export type ConsistencyCheck = z.infer<typeof consistencyCheckSchema>;

const visibleRegionSchema = z.object({
  name: z.string(),
  description: z.string(),
  role: z.string().optional(),
  bounds: boundsSchema,
  relation: z.string().optional(),
  nodeUid: z.string().optional(),
  confidence: confidenceSchema,
  evidence: evidenceSchema,
});

export const visionAnalysisSchema = z.object({
  componentBoundary: z.object({
    kind: z.string(),
    confidence: confidenceSchema,
    evidence: evidenceSchema,
  }),
  visualGrouping: z.object({
    relationships: z.array(z.string()),
    confidence: confidenceSchema,
    evidence: evidenceSchema,
  }),
  visualSemantics: z.array(
    z.object({
      element: z.string(),
      role: z.string(),
      description: z.string().optional(),
      bounds: boundsSchema,
      relation: z.string().optional(),
      confidence: confidenceSchema,
      evidence: evidenceSchema,
    }),
  ),
  visibleRegions: z.array(visibleRegionSchema).optional(),
  stateChanges: z.array(
    z.object({
      state: z.string(),
      changes: z.array(z.string()),
      confidence: confidenceSchema,
      evidence: evidenceSchema,
    }),
  ),
  consistencyChecks: z.array(consistencyCheckSchema),
  appearance: z
    .object({
      palette: z.array(z.string()),
      surfaceTreatment: z.string(),
      appearanceDescription: z.string(),
      subcomponents: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          bounds: boundsSchema,
          relation: z.string().optional(),
        }),
      ),
    })
    .optional(),
  overallConfidence: confidenceSchema,
  unknowns: z.array(z.string()),
});
export type VisionAnalysis = z.infer<typeof visionAnalysisSchema>;

export const visionEvidenceSchema = z.object({
  source: z.enum(["vision", "delegate"]),
  analysis: visionAnalysisSchema,
});
export type VisionEvidence = z.infer<typeof visionEvidenceSchema>;
