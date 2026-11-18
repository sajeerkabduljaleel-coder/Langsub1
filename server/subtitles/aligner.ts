import type {
  AlignedCuePair,
  AlignmentPreviewData,
  AlignmentRelationship,
  AlignmentStats,
  RawCue,
  UnmatchedBaseCue,
} from '../../src/types/subtitle.ts';

export interface AlignDualOptions {
  /**
   * When true (default), base-language cues that do not match any target cue are
   * preserved as chronological entries (`relationship: 'unmatched-base'`) so no
   * dialogue is ever silently discarded.
   */
  includeUnmatchedBase?: boolean;
  /**
   * Confidence threshold below which a cue is flagged `uncertain: true` for
   * pre-conversion user inspection. Defaults to 0.65.
   */
  uncertainThreshold?: number;
}

interface ShiftedBaseCue extends RawCue {
  bIdx: number;
  shiftedStart: number;
  shiftedEnd: number;
}

function intervalIntersectionMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const interStart = Math.max(aStart, bStart);
  const interEnd = Math.min(aEnd, bEnd);
  return Math.max(0, interEnd - interStart);
}

function intervalIoU(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const inter = intervalIntersectionMs(aStart, aEnd, bStart, bEnd);
  const union = Math.max(aEnd, bEnd) - Math.min(aStart, bStart);
  if (union <= 0) return 0;
  return inter / union;
}

function normalizeForAlignment(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/[“”„«»"']/g, '')
    .replace(/[.…,!?;:—–\-()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function effectiveVisualLength(text: string): number {
  const norm = normalizeForAlignment(text);
  if (!norm) return 1;
  // CJK characters carry ~2.4x semantic density per character compared to Latin words
  const cjkCount = (norm.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
  const nonCjkCount = norm.length - cjkCount;
  return Math.max(1, nonCjkCount + cjkCount * 2.4);
}

function structuralCompatibility(targetText: string, baseText: string): number {
  const tLen = effectiveVisualLength(targetText);
  const bLen = effectiveVisualLength(baseText);
  const lenRatio = Math.min(tLen, bLen) / Math.max(tLen, bLen);

  // Boost when shared numbers or Latin tokens (e.g. names/places/times) appear in both cues
  const tNums = targetText.match(/\d+/g) || [];
  const bNums = new Set(baseText.match(/\d+/g) || []);
  let bonus = 0;
  if (tNums.length > 0 && tNums.some((n) => bNums.has(n))) {
    bonus += 0.15;
  }

  const tTokens = new Set(
    normalizeForAlignment(targetText)
      .split(' ')
      .filter((w) => w.length >= 4 && /^[a-zà-öø-ÿ]+$/i.test(w)),
  );
  const bTokens = normalizeForAlignment(baseText)
    .split(' ')
    .filter((w) => w.length >= 4 && /^[a-zà-öø-ÿ]+$/i.test(w));
  if (tTokens.size > 0 && bTokens.some((w) => tTokens.has(w))) {
    bonus += 0.1;
  }

  return Math.min(1, 0.45 + 0.55 * lenRatio + bonus);
}

/**
 * Estimates a global timing offset (targetMs - baseMs) via consensus delta
 * clustering up to +/- 60 seconds, handling large recap/intro shifts accurately.
 */
export function estimateGlobalOffsetMs(targetCues: RawCue[], baseCues: RawCue[]): number {
  if (targetCues.length === 0 || baseCues.length === 0) return 0;

  if (targetCues.length < 3 || baseCues.length < 3) {
    if (targetCues.length !== baseCues.length) return 0;
    const t0 = targetCues[0];
    const b0 = baseCues[0];
    if (intervalIoU(t0.startMs, t0.endMs, b0.startMs, b0.endMs) > 0.2) return 0;
    const tMid = (t0.startMs + t0.endMs) / 2;
    const bMid = (b0.startMs + b0.endMs) / 2;
    const diff = tMid - bMid;
    const durRatio =
      Math.min(t0.endMs - t0.startMs, b0.endMs - b0.startMs) /
      Math.max(1, Math.max(t0.endMs - t0.startMs, b0.endMs - b0.startMs));
    return Math.abs(diff) > 150 && Math.abs(diff) <= 30000 && durRatio >= 0.7
      ? Math.round(diff)
      : 0;
  }

  const maxOffsetMs = 60000;
  const binSizeMs = 250;
  const sampleCount = Math.min(60, targetCues.length);
  const step = Math.max(1, Math.floor(targetCues.length / sampleCount));
  const sampledTargets: RawCue[] = [];
  for (let i = 0; i < targetCues.length; i += step) {
    sampledTargets.push(targetCues[i]);
  }

  const histogram = new Map<number, number>();
  const perTargetPairs: Array<Array<{ delta: number; weight: number }>> = [];

  for (const t of sampledTargets) {
    const tMid = (t.startMs + t.endMs) / 2;
    const tDur = Math.max(200, t.endMs - t.startMs);
    const pairs: Array<{ delta: number; weight: number }> = [];

    for (const b of baseCues) {
      const bMid = (b.startMs + b.endMs) / 2;
      const delta = tMid - bMid;
      if (Math.abs(delta) > maxOffsetMs) continue;

      const bDur = Math.max(200, b.endMs - b.startMs);
      const durRatio = Math.min(tDur, bDur) / Math.max(tDur, bDur);
      if (durRatio < 0.25) continue;

      const weight = 0.4 + 0.6 * durRatio;
      pairs.push({ delta, weight });

      const bin = Math.round(delta / binSizeMs) * binSizeMs;
      histogram.set(bin, (histogram.get(bin) || 0) + weight);
      histogram.set(bin - binSizeMs, (histogram.get(bin - binSizeMs) || 0) + weight * 0.5);
      histogram.set(bin + binSizeMs, (histogram.get(bin + binSizeMs) || 0) + weight * 0.5);
    }

    perTargetPairs.push(pairs);
  }

  if (histogram.size === 0) return 0;

  let peakBin = 0;
  let peakWeight = -1;
  for (const [bin, weight] of histogram.entries()) {
    if (weight > peakWeight) {
      peakWeight = weight;
      peakBin = bin;
    }
  }

  const supportingDeltas: number[] = [];
  for (const pairs of perTargetPairs) {
    let bestDelta: number | null = null;
    let bestDist = Infinity;
    for (const p of pairs) {
      const dist = Math.abs(p.delta - peakBin);
      if (dist <= 1200 && dist < bestDist) {
        bestDist = dist;
        bestDelta = p.delta;
      }
    }
    if (bestDelta !== null) {
      supportingDeltas.push(bestDelta);
    }
  }

  const minSupport = Math.max(3, Math.floor(sampledTargets.length * 0.25));
  if (supportingDeltas.length < minSupport) return 0;

  supportingDeltas.sort((a, b) => a - b);
  const median = supportingDeltas[Math.floor(supportingDeltas.length / 2)];
  return Math.abs(median) > 150 ? Math.round(median) : 0;
}

/**
 * Attempts to split a single base-language cue cleanly into `partsCount`
 * segments when multiple target cues map to it (many-to-one).
 */
function splitBaseTextForManyToOne(
  cue: ShiftedBaseCue,
  partsCount: number,
): string[] | null {
  if (partsCount < 2) return null;

  // 1. Prefer explicit line breaks if line count matches
  const rawLines = (cue.originalText || cue.text)
    .replace(/\\N|\\n/g, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length === partsCount) {
    return rawLines;
  }

  const text = cue.text.replace(/\s+/g, ' ').trim();
  // 2. Try splitting by strong sentence boundaries, dialogue dashes, or clauses
  const splitPatterns = [
    /(?<=[.!?…])\s+/,
    /\s+(?=[—–-]\s*)/,
    /(?<=[,;:])\s+/,
  ];

  for (const pat of splitPatterns) {
    const tokens = text.split(pat).map((s) => s.trim()).filter(Boolean);
    if (tokens.length === partsCount) {
      return tokens;
    }
    if (tokens.length > partsCount) {
      // Greedily merge adjacent clauses into `partsCount` balanced chunks
      const buckets: string[] = [];
      let cursor = 0;
      for (let i = 0; i < partsCount; i++) {
        const remainingParts = partsCount - i;
        const remainingTokens = tokens.length - cursor;
        const take = Math.max(1, Math.round(remainingTokens / remainingParts));
        buckets.push(tokens.slice(cursor, cursor + take).join(' '));
        cursor += take;
      }
      if (buckets.every((b) => b.length > 0)) {
        return buckets;
      }
    }
  }

  return null;
}

interface TargetAssignment {
  tIdx: number;
  baseIndices: number[];
  confidence: number;
  relationship: AlignmentRelationship;
}

/**
 * Aligns target-language and base-language subtitle cues using consensus global
 * offset estimation, temporal IoU, structural compatibility, 1-to-many and
 * many-to-one segmentation handling, while never silently discarding unmatched dialogue.
 */
export function alignDualSubtitles(
  targetCues: RawCue[],
  baseCues: RawCue[],
  options: AlignDualOptions = {},
): AlignmentPreviewData {
  const includeUnmatchedBase = options.includeUnmatchedBase !== false;
  const uncertainThreshold = options.uncertainThreshold ?? 0.65;

  const estimatedOffsetMs = estimateGlobalOffsetMs(targetCues, baseCues);
  const shiftedBase: ShiftedBaseCue[] = baseCues
    .map((b, bIdx) => {
      const shiftedStart = Math.max(0, b.startMs + estimatedOffsetMs);
      const shiftedEnd =
        b.endMs > b.startMs
          ? Math.max(shiftedStart + 1, b.endMs + estimatedOffsetMs)
          : shiftedStart + 200;
      return {
        ...b,
        bIdx,
        shiftedStart,
        shiftedEnd,
      };
    })
    .sort((a, b) => a.shiftedStart - b.shiftedStart || a.shiftedEnd - b.shiftedEnd);

  // Re-index bIdx after chronological sort so consecutive run checks remain strictly chronological
  shiftedBase.forEach((b, idx) => {
    b.bIdx = idx;
  });

  const assignments: TargetAssignment[] = [];
  let baseCursor = 0;

  // Pass 1: Score single-base and consecutive multi-base (1-to-many) matches per target cue
  for (let tIdx = 0; tIdx < targetCues.length; tIdx++) {
    const t = targetCues[tIdx];
    const tMid = (t.startMs + t.endMs) / 2;
    const tDur = Math.max(100, t.endMs - t.startMs);

    while (
      baseCursor < shiftedBase.length - 1 &&
      shiftedBase[baseCursor].shiftedEnd < t.startMs - 3000
    ) {
      baseCursor++;
    }

    const candidates: Array<{
      bIdx: number;
      score: number;
      iou: number;
      baseCov: number;
      targetCov: number;
    }> = [];

    for (let bIdx = Math.max(0, baseCursor - 6); bIdx < shiftedBase.length; bIdx++) {
      const b = shiftedBase[bIdx];
      if (b.shiftedStart > t.endMs + 3000) break;

      const inter = intervalIntersectionMs(t.startMs, t.endMs, b.shiftedStart, b.shiftedEnd);
      const iou = intervalIoU(t.startMs, t.endMs, b.shiftedStart, b.shiftedEnd);
      const bDur = Math.max(200, b.shiftedEnd - b.shiftedStart);
      const baseCov = inter / bDur;
      const targetCov = inter / tDur;

      const bMid = (b.shiftedStart + b.shiftedEnd) / 2;
      const midDist = Math.abs(tMid - bMid);
      const proximity = Math.exp(-(midDist * midDist) / (2 * 950 * 950));
      const structScore = structuralCompatibility(t.text, b.text);

      const score = iou * 0.62 + proximity * 0.24 + structScore * 0.14;
      if (iou > 0.06 || midDist <= 1500) {
        candidates.push({ bIdx, score, iou, baseCov, targetCov });
      }
    }

    if (candidates.length === 0) {
      assignments.push({
        tIdx,
        baseIndices: [],
        confidence: 0,
        relationship: 'unmatched-target',
      });
      continue;
    }

    candidates.sort((a, b) => b.score - a.score);
    const primary = candidates[0];

    // Check 1-to-many: consecutive base cues [startB .. endB] that together fit this target cue better
    let bestRun: { indices: number[]; score: number; iou: number } | null = null;
    const candidateMap = new Map(candidates.map((c) => [c.bIdx, c]));

    for (let len = 2; len <= 4; len++) {
      for (let startOffset = -(len - 1); startOffset <= 0; startOffset++) {
        const startB = primary.bIdx + startOffset;
        const endB = startB + len - 1;
        if (startB < 0 || endB >= shiftedBase.length) continue;

        const runIndices: number[] = [];
        let validRun = true;
        for (let k = startB; k <= endB; k++) {
          const cand = candidateMap.get(k);
          const b = shiftedBase[k];
          if (!cand || (cand.baseCov < 0.42 && cand.iou < 0.16)) {
            validRun = false;
            break;
          }
          if (k > startB) {
            const prevB = shiftedBase[k - 1];
            if (b.shiftedStart - prevB.shiftedEnd > 1500) {
              validRun = false;
              break;
            }
          }
          runIndices.push(k);
        }

        if (!validRun) continue;

        const spanStart = shiftedBase[startB].shiftedStart;
        const spanEnd = shiftedBase[endB].shiftedEnd;
        const spanIoU = intervalIoU(t.startMs, t.endMs, spanStart, spanEnd);
        const spanMid = (spanStart + spanEnd) / 2;
        const spanProx = Math.exp(-((tMid - spanMid) ** 2) / (2 * 950 * 950));
        const mergedText = runIndices.map((idx) => shiftedBase[idx].text).join(' ');
        const spanStruct = structuralCompatibility(t.text, mergedText);
        const spanScore = spanIoU * 0.65 + spanProx * 0.22 + spanStruct * 0.13;

        if (
          spanIoU >= primary.iou + 0.12 &&
          spanIoU >= 0.35 &&
          (!bestRun || spanScore > bestRun.score)
        ) {
          bestRun = { indices: runIndices, score: spanScore, iou: spanIoU };
        }
      }
    }

    if (bestRun) {
      assignments.push({
        tIdx,
        baseIndices: bestRun.indices,
        confidence: Number(Math.min(0.98, bestRun.score).toFixed(2)),
        relationship: 'one-to-many',
      });
    } else {
      const rel: AlignmentRelationship =
        primary.iou >= 0.45 ? 'exact' : 'interpolated';
      assignments.push({
        tIdx,
        baseIndices: [primary.bIdx],
        confidence: Number(Math.min(1, primary.score).toFixed(2)),
        relationship: rel,
      });
    }
  }

  // Pass 2: Detect and resolve many-to-one (multiple target cues mapping to the same single base cue)
  const baseToTargets = new Map<number, number[]>();
  for (const a of assignments) {
    if (a.baseIndices.length === 1) {
      const bIdx = a.baseIndices[0];
      const list = baseToTargets.get(bIdx) || [];
      list.push(a.tIdx);
      baseToTargets.set(bIdx, list);
    }
  }

  const resolvedPairs = new Map<number, { baseText: string; confidence: number; relationship: AlignmentRelationship }>();
  const usedBaseIndices = new Set<number>();

  for (const [bIdx, tIndices] of baseToTargets.entries()) {
    if (tIndices.length <= 1) continue;

    // Sort target cues chronologically
    tIndices.sort((x, y) => x - y);
    const baseCue = shiftedBase[bIdx];
    const spanStart = targetCues[tIndices[0]].startMs;
    const spanEnd = targetCues[tIndices[tIndices.length - 1]].endMs;
    const spanIoU = intervalIoU(spanStart, spanEnd, baseCue.shiftedStart, baseCue.shiftedEnd);

    const splitParts = splitBaseTextForManyToOne(baseCue, tIndices.length);
    if (splitParts) {
      const conf = Number(Math.min(0.88, Math.max(0.55, spanIoU * 0.9)).toFixed(2));
      tIndices.forEach((tIdx, pos) => {
        resolvedPairs.set(tIdx, {
          baseText: splitParts[pos],
          confidence: conf,
          relationship: 'many-to-one',
        });
      });
      usedBaseIndices.add(bIdx);
    } else {
      // Cannot split cleanly grammatically: assign full base text to highest-IoU target cue,
      // mark siblings as many-to-one with empty baseText so AI translates them cleanly without duplicating text.
      let bestT = tIndices[0];
      let bestIoU = -1;
      for (const tIdx of tIndices) {
        const t = targetCues[tIdx];
        const iou = intervalIoU(t.startMs, t.endMs, baseCue.shiftedStart, baseCue.shiftedEnd);
        if (iou > bestIoU) {
          bestIoU = iou;
          bestT = tIdx;
        }
      }
      for (const tIdx of tIndices) {
        if (tIdx === bestT) {
          resolvedPairs.set(tIdx, {
            baseText: baseCue.text,
            confidence: Number(Math.min(0.62, Math.max(0.4, bestIoU * 0.85)).toFixed(2)),
            relationship: 'many-to-one',
          });
        } else {
          resolvedPairs.set(tIdx, {
            baseText: '',
            confidence: 0.35,
            relationship: 'many-to-one',
          });
        }
      }
      usedBaseIndices.add(bIdx);
    }
  }

  // Build aligned list from target assignments
  const aligned: AlignedCuePair[] = [];

  for (const a of assignments) {
    const t = targetCues[a.tIdx];
    const m2o = resolvedPairs.get(a.tIdx);

    if (m2o) {
      aligned.push({
        id: `align-t-${t.index}`,
        index: t.index,
        startMs: t.startMs,
        endMs: t.endMs,
        targetText: t.text,
        baseText: m2o.baseText,
        confidence: m2o.confidence,
        relationship: m2o.relationship,
        uncertain: m2o.confidence < uncertainThreshold || !m2o.baseText,
        matchedTargetIndices: [t.index],
        matchedBaseIndices: a.baseIndices.map((idx) => shiftedBase[idx].index),
      });
      continue;
    }

    if (a.baseIndices.length === 0) {
      aligned.push({
        id: `align-t-${t.index}`,
        index: t.index,
        startMs: t.startMs,
        endMs: t.endMs,
        targetText: t.text,
        baseText: '',
        confidence: 0,
        relationship: 'unmatched-target',
        uncertain: true,
        matchedTargetIndices: [t.index],
        matchedBaseIndices: [],
      });
      continue;
    }

    for (const bIdx of a.baseIndices) {
      usedBaseIndices.add(bIdx);
    }

    const combinedBase = a.baseIndices
      .map((idx) => shiftedBase[idx].text)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    aligned.push({
      id: `align-t-${t.index}`,
      index: t.index,
      startMs: t.startMs,
      endMs: t.endMs,
      targetText: t.text,
      baseText: combinedBase,
      confidence: a.confidence,
      relationship: a.relationship,
      uncertain: a.confidence < uncertainThreshold || a.relationship === 'interpolated',
      matchedTargetIndices: [t.index],
      matchedBaseIndices: a.baseIndices.map((idx) => shiftedBase[idx].index),
    });
  }

  // Collect unmatched base cues so they are NEVER silently discarded
  const unmatchedBaseCues: UnmatchedBaseCue[] = [];
  for (const b of shiftedBase) {
    if (!usedBaseIndices.has(b.bIdx)) {
      unmatchedBaseCues.push({
        index: b.index,
        startMs: b.startMs,
        endMs: b.endMs,
        shiftedStartMs: b.shiftedStart,
        shiftedEndMs: b.shiftedEnd,
        text: b.text,
      });

      if (includeUnmatchedBase) {
        aligned.push({
          id: `align-b-${b.index}`,
          index: b.index,
          startMs: b.shiftedStart,
          endMs: b.shiftedEnd,
          targetText: '',
          baseText: b.text,
          confidence: 0,
          relationship: 'unmatched-base',
          uncertain: true,
          matchedTargetIndices: [],
          matchedBaseIndices: [b.index],
        });
      }
    }
  }

  // Sort chronologically and assign clean sequential indices
  aligned.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  aligned.forEach((pair, idx) => {
    pair.index = idx + 1;
  });

  const exactMatches = aligned.filter((a) => a.relationship === 'exact').length;
  const interpolatedMatches = aligned.filter((a) => a.relationship === 'interpolated').length;
  const oneToManyMatches = aligned.filter((a) => a.relationship === 'one-to-many').length;
  const manyToOneMatches = aligned.filter((a) => a.relationship === 'many-to-one').length;
  const unmatchedTarget = aligned.filter((a) => a.relationship === 'unmatched-target').length;
  const uncertainCount = aligned.filter((a) => a.uncertain).length;
  const averageConfidence =
    aligned.length > 0
      ? Number(
          (
            aligned.reduce((sum, a) => sum + a.confidence, 0) / aligned.length
          ).toFixed(2),
        )
      : 0;

  let overlappingCues = 0;
  for (let i = 1; i < aligned.length; i++) {
    if (aligned[i].startMs < aligned[i - 1].endMs) {
      overlappingCues++;
    }
  }

  const stats: AlignmentStats = {
    exactMatches,
    interpolatedMatches,
    oneToManyMatches,
    manyToOneMatches,
    unmatchedTarget,
    unmatchedBase: unmatchedBaseCues.length,
    uncertainCount,
    averageConfidence,
    estimatedOffsetMs,
    overlappingCues,
  };

  return {
    aligned,
    unmatchedBaseCues,
    stats,
  };
}

export interface SentenceContinuationHint {
  index: number;
  continuesFromPrev: boolean;
  continuesToNext: boolean;
}

const TERMINAL_PUNCTUATION_REGEX = /[.!?…。！？»"')\]—]$/;

/**
 * Identifies dialogue sentences split across consecutive cues so translation can
 * treat multi-cue sentences coherently without breaking per-cue timestamps.
 */
export function annotateSplitSentences(
  cues: Array<{ index: number; startMs: number; endMs: number; text: string }>,
): SentenceContinuationHint[] {
  return cues.map((cue, idx) => {
    const trimmed = cue.text.trim();
    const prev = idx > 0 ? cues[idx - 1] : null;
    const next = idx + 1 < cues.length ? cues[idx + 1] : null;

    const prevContinues =
      Boolean(prev) &&
      cue.startMs - prev!.endMs <= 2500 &&
      prev!.text.trim().length > 0 &&
      !TERMINAL_PUNCTUATION_REGEX.test(prev!.text.trim());

    const nextContinues =
      Boolean(next) &&
      next!.startMs - cue.endMs <= 2500 &&
      trimmed.length > 0 &&
      !TERMINAL_PUNCTUATION_REGEX.test(trimmed);

    return {
      index: cue.index,
      continuesFromPrev: prevContinues,
      continuesToNext: nextContinues,
    };
  });
}

export interface AlignmentAuditSummary {
  totalCues: number;
  overlappingCount: number;
  uncertainCount: number;
  unmatchedTargetCount: number;
  unmatchedBaseCount: number;
  duplicateAdjacentCount: number;
}

export function auditAlignedCues(aligned: AlignedCuePair[]): AlignmentAuditSummary {
  let overlappingCount = 0;
  let duplicateAdjacentCount = 0;

  for (let i = 1; i < aligned.length; i++) {
    const prev = aligned[i - 1];
    const curr = aligned[i];
    if (curr.startMs < prev.endMs) {
      overlappingCount++;
    }
    const prevNorm = (prev.targetText || prev.baseText).trim().toLowerCase().replace(/\s+/g, ' ');
    const currNorm = (curr.targetText || curr.baseText).trim().toLowerCase().replace(/\s+/g, ' ');
    if (prevNorm && currNorm && prevNorm === currNorm && curr.startMs - prev.endMs <= 500) {
      duplicateAdjacentCount++;
    }
  }

  return {
    totalCues: aligned.length,
    overlappingCount,
    uncertainCount: aligned.filter((a) => a.uncertain).length,
    unmatchedTargetCount: aligned.filter((a) => a.relationship === 'unmatched-target').length,
    unmatchedBaseCount: aligned.filter((a) => a.relationship === 'unmatched-base').length,
    duplicateAdjacentCount,
  };
}
