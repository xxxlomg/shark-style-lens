import { z } from "zod";
import type { ConsistencyCheck } from "@stylelens/contracts";
import type { LightProfile, LightSubtreeNode } from "./types";

export type EvidenceStatus = "observed" | "inferred" | "conflict" | "unknown";

export interface EvidenceClaim {
  id: string;
  subject: string;
  property: string;
  value: unknown;
  source: string;
  status: EvidenceStatus;
  confidence: number;
  evidenceRefs: string[];
}

export interface EvidenceConflict {
  id: string;
  claim: string;
  property: string;
  status: "conflict";
  candidates: Array<{
    source: string;
    subject?: string;
    property?: string;
    value: unknown;
    evidenceRefs?: string[];
  }>;
  evidenceRefs: string[];
  resolution: {
    status: "preserved";
    decision:
      | "browser-authoritative"
      | "visual-authoritative"
      | "preserve-both"
      | "unknown";
    rule: string;
    implementationConstraint: string;
  };
}

export interface EvidencePack {
  schemaVersion: "0.2.0";
  metadata: {
    source: string;
    profileVersion: string;
    analysisScope: string;
    generatedAt: string;
    viewport?: { width: number; height: number };
    devicePixelRatio?: number;
    colorScheme?: string;
  };
  target: Record<string, unknown>;
  claims: EvidenceClaim[];
  browserFacts: EvidenceClaim[];
  visualObservations: EvidenceClaim[];
  derivedConstraints: EvidenceClaim[];
  inferences: EvidenceClaim[];
  componentInventory: Array<Record<string, unknown>>;
  interactionInventory: Array<Record<string, unknown>>;
  interactionClaims: EvidenceClaim[];
  interactionContracts: Array<Record<string, unknown>>;
  componentCapture?: Record<string, unknown>;
  conflicts: EvidenceConflict[];
  unknowns: string[];
  warnings: Array<Record<string, unknown>>;
}

const evidenceClaimSchema = z.object({
  id: z.string(),
  subject: z.string(),
  property: z.string(),
  value: z.unknown(),
  source: z.string(),
  status: z.enum(["observed", "inferred", "conflict", "unknown"]),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()),
});

const evidenceConflictSchema = z.object({
  id: z.string(),
  claim: z.string(),
  property: z.string(),
  status: z.literal("conflict"),
  candidates: z
    .array(
      z.object({
        source: z.string(),
        subject: z.string().optional(),
        property: z.string().optional(),
        value: z.unknown(),
        evidenceRefs: z.array(z.string()).optional(),
      }),
    )
    .min(2),
  evidenceRefs: z.array(z.string()),
  resolution: z.object({
    status: z.literal("preserved"),
    decision: z.enum([
      "browser-authoritative",
      "visual-authoritative",
      "preserve-both",
      "unknown",
    ]),
    rule: z.string(),
    implementationConstraint: z.string(),
  }),
});

export const evidencePackSchema = z.object({
  schemaVersion: z.literal("0.2.0"),
  metadata: z.object({
    source: z.string(),
    profileVersion: z.string(),
    analysisScope: z.string(),
    generatedAt: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }).optional(),
    devicePixelRatio: z.number().optional(),
    colorScheme: z.string().optional(),
  }),
  target: z.record(z.string(), z.unknown()),
  claims: z.array(evidenceClaimSchema),
  browserFacts: z.array(evidenceClaimSchema),
  visualObservations: z.array(evidenceClaimSchema),
  derivedConstraints: z.array(evidenceClaimSchema),
  inferences: z.array(evidenceClaimSchema),
  componentInventory: z.array(z.record(z.string(), z.unknown())),
  interactionInventory: z.array(z.record(z.string(), z.unknown())),
  interactionClaims: z.array(evidenceClaimSchema),
  interactionContracts: z.array(z.record(z.string(), z.unknown())),
  componentCapture: z.record(z.string(), z.unknown()).optional(),
  conflicts: z.array(evidenceConflictSchema),
  unknowns: z.array(z.string()),
  warnings: z.array(z.record(z.string(), z.unknown())),
});

function array<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function confidence(value: unknown, fallback = 0.5): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function claim(
  id: string,
  subject: string,
  property: string,
  value: unknown,
  source: string,
  status: EvidenceStatus,
  confidenceValue: unknown,
  evidenceRefs: unknown,
): EvidenceClaim {
  return {
    id,
    subject,
    property,
    value,
    source,
    status,
    confidence: confidence(confidenceValue, status === "observed" ? 1 : 0.5),
    evidenceRefs: array(
      typeof evidenceRefs === "string"
        ? [evidenceRefs]
        : (evidenceRefs as string[] | undefined),
    ),
  };
}

function inventory(
  nodes: LightSubtreeNode[],
  parentPath = "root",
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  nodes.forEach((node, index) => {
    const path = `${parentPath}.${index + 1}`;
    result.push({
      path,
      uid: node.uid,
      parentUid: node.parentUid,
      tagName: node.tagName,
      role: node.semanticRole || node.roleGuess,
      interactive: Boolean(node.interactive),
      nativeRole: node.nativeRole,
      accessibleName: node.accessibleName,
      labelledBy: node.labelledBy,
      controls: node.controls,
      hasPopup: node.hasPopup,
      visibilityState: node.visibilityState,
      effectiveOpacity: node.effectiveOpacity,
      state: node.state,
      attributes: node.attributes,
      semanticRole: node.semanticRole,
      actionHint: node.actionHint,
      control: node.control,
      rect: node.rect,
      layout: node.layout,
      computed: node.computed,
      visual: {
        background: node.background,
        color: node.color,
        border: node.border,
        radius: node.radius,
        shadow: node.shadow,
      },
      typography: node.typography,
      pseudoElements: node.pseudoElements,
      textContent: node.textContent,
    });
    result.push(...inventory(node.children, path));
  });
  return result;
}

function interactionInventory(
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return items
    .filter(
      (item) =>
        item.interactive === true ||
        ["button", "input", "control", "link"].includes(String(item.role)),
    )
    .map((item) => ({
      path: item.path,
      uid: item.uid,
      role: item.role,
      nativeRole: item.nativeRole,
      accessibleName: item.accessibleName,
      labelledBy: item.labelledBy,
      controls: item.controls,
      hasPopup: item.hasPopup,
      interactive: item.interactive,
      actionHint: item.actionHint,
      control: item.control,
      attributes: item.attributes,
      textContent: item.textContent,
      state: item.state,
      rect: item.rect,
      source: "browser-dom",
    }));
}

function snapshotSubset(
  snapshot: NonNullable<LightProfile["interactions"]>[number]["before"],
  relevantUids: Set<string>,
): Record<string, unknown> {
  const selectedUids = new Set(relevantUids);
  selectedUids.add(snapshot.rootUid);
  return {
    rootUid: snapshot.rootUid,
    focusedUid: snapshot.focusedUid,
    nodes: snapshot.nodes.filter((node) => selectedUids.has(String(node.uid))),
  };
}

function buildInteractionContracts(
  interactions: LightProfile["interactions"],
): Array<Record<string, unknown>> {
  return array(interactions).map((interaction) => {
    const relevantUids = new Set([
      interaction.triggerUid,
      ...interaction.changedNodeUids,
      ...interaction.relatedNodeUids,
      ...interaction.overlayUids,
    ]);
    return {
      id: interaction.id,
      triggerUid: interaction.triggerUid,
      triggerName: interaction.triggerName,
      event: interaction.event,
      risk: interaction.risk,
      status: interaction.status,
      before: snapshotSubset(interaction.before, relevantUids),
      after: snapshotSubset(interaction.after, relevantUids),
      mutations: interaction.mutations,
      geometryChanges: interaction.geometryChanges,
      focusBefore: interaction.focusBefore,
      focusAfter: interaction.focusAfter,
      changedNodeUids: interaction.changedNodeUids,
      relatedNodeUids: interaction.relatedNodeUids,
      overlayUids: interaction.overlayUids,
      observedBehavior: interaction.observedBehavior,
      confidence: interaction.confidence,
      source: "browser-interaction-observation",
    };
  });
}

const PROPERTY_ALIASES: Record<string, string[]> = {
  "surface-color": ["background-color", "background"],
  paint: ["background-color", "background-image", "box-shadow", "border"],
  geometry: ["x", "y", "width", "height", "top", "right", "bottom", "left"],
  bounds: ["x", "y", "width", "height", "top", "right", "bottom", "left"],
  clipping: ["overflow", "clip-path", "mask-image"],
  layering: ["z-index", "position", "isolation"],
  typography: [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "color",
  ],
};

function normalizedProperty(value: string | undefined): string {
  return (value ?? "legacy-consistency")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function browserPropertyMatches(
  factProperty: string,
  property: string,
): boolean {
  const fact = normalizedProperty(factProperty);
  const requested = normalizedProperty(property);
  if (fact === requested) return true;
  return (PROPERTY_ALIASES[requested] ?? []).includes(fact);
}

function browserMatches(
  profile: LightProfile,
  property: string,
): EvidenceClaim[] {
  return profile.facts
    .filter(
      (fact) =>
        (fact.targetUid === undefined ||
          fact.targetUid === profile.target.uid) &&
        browserPropertyMatches(fact.property, property),
    )
    .slice(0, 12)
    .map((fact, index) =>
      claim(
        `browser-conflict-${index + 1}`,
        fact.targetUid ?? profile.target.uid,
        fact.property,
        fact.value,
        "browser-fact",
        "observed",
        fact.confidence,
        [fact.source],
      ),
    );
}

function checkedBrowserValue(
  profile: LightProfile,
  check: ConsistencyCheck,
): Record<string, unknown> {
  const property = normalizedProperty(check.property);
  const actual = browserMatches(profile, property);
  const reported = check.browserValue;
  const hasReport = reported !== undefined && reported !== null;
  const verified = !hasReport
    ? "not-reported"
    : actual.some(
          (fact) => String(fact.value).trim() === String(reported).trim(),
        )
      ? "matched-browser-fact"
      : "unverified-browser-report";
  return {
    property,
    browserValue: actual.length
      ? actual.map((fact) => ({
          subject: fact.subject,
          property: fact.property,
          value: fact.value,
        }))
      : null,
    reportedBrowserValue: hasReport ? reported : null,
    browserValueVerification: verified,
    visualValue: check.visualValue ?? check.claim ?? null,
    resolution: check.resolution ?? "unknown",
    status: check.status,
  };
}

function checkLabel(check: ConsistencyCheck): string {
  if (check.claim) return check.claim;
  const property = check.property ?? "unspecified property";
  return `${property}: browser=${JSON.stringify(check.browserValue ?? null)}; visual=${JSON.stringify(check.visualValue ?? null)}`;
}

function decisionForCheck(
  check: ConsistencyCheck,
  hasBrowserFact: boolean,
): EvidenceConflict["resolution"]["decision"] {
  if (check.status === "unknown") return "unknown";
  const property = normalizedProperty(check.property);
  if (
    [
      "geometry",
      "bounds",
      "native-state",
      "css-declaration",
      "computed-style",
    ].includes(property)
  )
    return "browser-authoritative";
  if (
    [
      "visual-grouping",
      "component-boundary",
      "clipping",
      "occlusion",
      "shadow",
      "edge-softness",
      "composited-paint",
    ].includes(property)
  )
    return "visual-authoritative";
  if (check.resolution && check.resolution !== "consistent") {
    if (check.resolution === "browser-authoritative")
      return "browser-authoritative";
    if (check.resolution === "visual-authoritative")
      return "visual-authoritative";
    if (check.resolution === "preserve-both") return "preserve-both";
  }
  return hasBrowserFact ? "preserve-both" : "unknown";
}

function resolutionRule(
  decision: EvidenceConflict["resolution"]["decision"],
): string {
  if (decision === "browser-authoritative")
    return "browser facts win for CSS declarations, native state, and measured geometry";
  if (decision === "visual-authoritative")
    return "screenshot observations win for composited paint, occlusion, clipping, edge softness, and visual grouping";
  if (decision === "preserve-both")
    return "preserve CSS declarations and screenshot-observed compositing as separate layers because they answer different questions";
  return "the available evidence is insufficient to choose a source";
}

function conflictForCheck(
  profile: LightProfile,
  check: ConsistencyCheck,
  index: number,
): EvidenceConflict | undefined {
  if (check.status !== "conflict") return undefined;
  const property = normalizedProperty(check.property);
  const browserValues = browserMatches(profile, property);
  const decision = decisionForCheck(check, browserValues.length > 0);
  const visualValue =
    check.visualValue ?? check.claim ?? "unknown visual value";
  const candidates: EvidenceConflict["candidates"] = browserValues.length
    ? browserValues.map((item) => ({
        source: "browser-fact",
        subject: item.subject,
        property: item.property,
        value: { property: item.property, value: item.value },
        evidenceRefs: item.evidenceRefs,
      }))
    : [
        {
          source: "browser-fact",
          subject: profile.target.uid,
          property,
          value: {
            status: "unknown",
            reason: "no matching browser fact was captured",
          },
        },
      ];
  candidates.push({
    source: "screenshot-observation",
    subject: profile.target.uid,
    property,
    value: visualValue,
    evidenceRefs: check.evidence,
  });
  return {
    id: `conflict-${index + 1}`,
    claim: checkLabel(check),
    property,
    status: "conflict",
    candidates,
    evidenceRefs: [
      ...new Set([
        ...check.evidence,
        ...browserValues.flatMap((item) => item.evidenceRefs),
      ]),
    ],
    resolution: {
      status: "preserved",
      decision,
      rule: resolutionRule(decision),
      implementationConstraint:
        decision === "browser-authoritative"
          ? "use the measured browser value for implementation and retain the screenshot observation as a visual diagnostic"
          : decision === "visual-authoritative"
            ? "use the screenshot observation for the rendered effect without rewriting measured DOM geometry"
            : decision === "preserve-both"
              ? "preserve both candidates: implement the browser-declared base and the screenshot-observed compositing or paint layer separately"
              : "leave the property unresolved and expose the missing evidence to the implementation agent",
    },
  };
}

/** Build an auditable, deterministic evidence layer before prompt synthesis. */
export function buildEvidencePack(profile: LightProfile): EvidencePack {
  const targetUid = profile.target.uid;
  const browserFacts = profile.facts.map((fact, index) =>
    claim(
      `browser-${index + 1}`,
      fact.targetUid ?? targetUid,
      fact.property,
      fact.value,
      "browser-fact",
      "observed",
      fact.confidence ?? 1,
      [fact.source],
    ),
  );
  const visualObservations: EvidenceClaim[] = [];
  const vision = profile.visionEvidence?.analysis;
  if (vision) {
    visualObservations.push(
      claim(
        "visual-boundary",
        targetUid,
        "component-boundary",
        vision.componentBoundary.kind,
        "vision",
        "observed",
        vision.componentBoundary.confidence,
        vision.componentBoundary.evidence,
      ),
    );
    visualObservations.push(
      claim(
        "visual-grouping",
        targetUid,
        "visual-grouping",
        vision.visualGrouping.relationships,
        "vision",
        "observed",
        vision.visualGrouping.confidence,
        vision.visualGrouping.evidence,
      ),
    );
    array(vision.visualSemantics).forEach((item, index) =>
      visualObservations.push(
        claim(
          `visual-semantic-${index + 1}`,
          item.element,
          "semantic-role",
          item.role,
          "vision",
          "inferred",
          item.confidence,
          item.evidence,
        ),
      ),
    );
    array(vision.visibleRegions).forEach((item, index) =>
      visualObservations.push(
        claim(
          `visible-region-${index + 1}`,
          item.nodeUid ?? targetUid,
          "visible-region",
          {
            name: item.name,
            description: item.description,
            bounds: item.bounds,
            relation: item.relation,
          },
          "vision",
          "observed",
          item.confidence,
          item.evidence,
        ),
      ),
    );
    array(vision.stateChanges).forEach((item, index) =>
      visualObservations.push(
        claim(
          `visual-state-${index + 1}`,
          targetUid,
          `state:${item.state}`,
          item.changes,
          "vision",
          "observed",
          item.confidence,
          item.evidence,
        ),
      ),
    );
    if (vision.appearance) {
      visualObservations.push(
        claim(
          "visual-appearance",
          targetUid,
          "appearance",
          vision.appearance,
          "vision",
          "observed",
          vision.overallConfidence,
          ["target-crop"],
        ),
      );
    }
    array(vision.consistencyChecks).forEach((item, index) =>
      visualObservations.push(
        claim(
          `consistency-${index + 1}`,
          targetUid,
          "dom-vision-consistency",
          {
            ...checkedBrowserValue(profile, item),
            claim: checkLabel(item),
          },
          "vision",
          item.status === "consistent"
            ? "observed"
            : item.status === "conflict"
              ? "conflict"
              : "unknown",
          0.6,
          item.evidence,
        ),
      ),
    );
  }

  const componentInventory = inventory(profile.componentTree ?? []);
  const interactionItems = interactionInventory(componentInventory);
  const interactionContracts = buildInteractionContracts(profile.interactions);
  const interactionClaims = interactionContracts.map((contract, index) =>
    claim(
      `interaction-${index + 1}`,
      String(contract.triggerUid ?? targetUid),
      "interaction-contract",
      contract,
      "browser-interaction",
      contract.status === "observed" ? "observed" : "unknown",
      contract.confidence,
      [`interaction:${String(contract.id ?? index + 1)}`],
    ),
  );
  const derivedConstraints = [
    claim(
      "derived-responsive",
      targetUid,
      "responsive-context",
      profile.responsive ?? {},
      "derived",
      "observed",
      1,
      ["responsive-profile"],
    ),
    claim(
      "derived-coordinate-space",
      targetUid,
      "coordinate-space",
      "componentTree rectangles are CSS-pixel offsets relative to the analysis root",
      "derived",
      "observed",
      1,
      ["component-tree"],
    ),
  ];
  const inferences = profile.inferences.map((item, index) =>
    claim(
      `inference-${index + 1}`,
      targetUid,
      item.type,
      item.conclusion,
      "model-inference",
      "inferred",
      item.confidence,
      item.reason,
    ),
  );
  const conflicts = array(vision?.consistencyChecks)
    .map((item, index) => conflictForCheck(profile, item, index))
    .filter((item): item is EvidenceConflict => Boolean(item));
  const unknowns = [
    ...array(vision?.unknowns),
    ...array(vision?.consistencyChecks)
      .filter((check) => check.status === "unknown")
      .map((check) => `Consistency unknown: ${checkLabel(check)}`),
    ...array(profile.warnings).map((warning) => warning.message),
    ...array(profile.states)
      .filter((state) => !state.captured)
      .map((state) => `${state.state} state was not captured`),
    ...array(profile.interactions)
      .filter((interaction) => interaction.status === "unknown")
      .map(
        (interaction) =>
          `Interaction ${interaction.triggerName ?? interaction.triggerUid} was not observed; do not invent its resulting behavior.`,
      ),
    ...array(profile.interactions)
      .filter((interaction) => interaction.status === "blocked")
      .map(
        (interaction) =>
          `Interaction ${interaction.triggerName ?? interaction.triggerUid} was intentionally not triggered because it was high risk.`,
      ),
  ];
  if (profile.componentCapture?.truncated) {
    unknowns.push(
      `Component tree is truncated after ${profile.componentCapture.capturedNodes} nodes; ${profile.componentCapture.omittedNodes} nodes (${profile.componentCapture.omittedInteractiveNodes} interactive) were omitted.`,
    );
  }
  array(vision?.consistencyChecks)
    .filter((check) => {
      const checked = checkedBrowserValue(profile, check);
      return checked.browserValueVerification === "unverified-browser-report";
    })
    .forEach((check) => {
      unknowns.push(
        `Vision browserValue was not found in captured browser facts: ${checkLabel(check)}`,
      );
    });

  const output: EvidencePack = {
    schemaVersion: "0.2.0",
    metadata: {
      source: "shark-stylelens-style-profile",
      profileVersion: profile.version,
      analysisScope: profile.analysisScope ?? "element",
      generatedAt: new Date().toISOString(),
      viewport: profile.responsive?.viewport,
      devicePixelRatio: profile.responsive?.devicePixelRatio,
      colorScheme: profile.responsive?.colorScheme,
    },
    target: {
      selectedUid: profile.target.selectedUid,
      analysisRootUid: targetUid,
      tagName: profile.target.tagName,
      role: profile.target.role,
      rect: profile.target.rect,
      classes: profile.target.classes,
      insideIframe: profile.target.insideIframe,
      isShadowBoundary: profile.target.isShadowBoundary,
      analysisProfiles: {
        layout: profile.layout ?? {},
        spacing: profile.spacing ?? {},
        typography: profile.typography ?? {},
        visual: profile.visual ?? {},
        assets: profile.assets ?? [],
        responsive: profile.responsive ?? {},
        pageContext: profile.pageContext ?? {},
        componentCapture: profile.componentCapture ?? {},
      },
    },
    claims: [
      ...browserFacts,
      ...visualObservations,
      ...derivedConstraints,
      ...inferences,
      ...interactionClaims,
    ],
    browserFacts,
    visualObservations,
    derivedConstraints,
    inferences,
    componentInventory,
    interactionInventory: interactionItems,
    interactionClaims,
    interactionContracts,
    componentCapture: profile.componentCapture,
    conflicts,
    unknowns: [...new Set(unknowns)],
    warnings: array(profile.warnings) as Array<Record<string, unknown>>,
  };
  evidencePackSchema.parse(output);
  return output;
}
