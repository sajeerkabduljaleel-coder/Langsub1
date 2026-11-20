import {
  DEFAULT_STYLE_CONFIG,
  type AssStyleConfig,
  type ConversionMode,
  type PhoneticStyle,
  type ProcessingReport,
  type SavedProject,
  type SubtitleFormat,
  type SubtitleLineRole,
  type TranslationStyle,
  type TriLineCue,
} from '../../src/types/subtitle.ts';

const VALID_ROLES: SubtitleLineRole[] = ['base', 'target', 'phonetic'];
const VALID_MODES: ConversionMode[] = ['target-first', 'base-first', 'dual-merge'];
const VALID_PHONETIC_STYLES: PhoneticStyle[] = ['hyphenated', 'flowing', 'standard'];
const VALID_TRANSLATION_STYLES: TranslationStyle[] = ['natural', 'literal', 'colloquial', 'formal'];
const VALID_FORMATS: SubtitleFormat[] = ['srt', 'vtt', 'ass'];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (!isValidHexColor(value)) return fallback;
  return value.trim().toUpperCase();
}

function normalizeFiniteNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // Strip commas and control/newline characters that would corrupt ASS Style records
  const cleaned = value
    .replace(/[\r\n,]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Safely normalizes any partial, legacy, or malformed styleConfig into a valid AssStyleConfig.
 */
export function sanitizeStyleConfig(
  raw: unknown,
  fallback: AssStyleConfig = DEFAULT_STYLE_CONFIG,
): AssStyleConfig {
  const base = isPlainObject(fallback) ? fallback : DEFAULT_STYLE_CONFIG;
  if (!isPlainObject(raw)) {
    return {
      ...DEFAULT_STYLE_CONFIG,
      ...base,
      lineOrder: [...(Array.isArray(base.lineOrder) ? base.lineOrder : DEFAULT_STYLE_CONFIG.lineOrder)],
    };
  }

  let lineOrder: SubtitleLineRole[] = [...base.lineOrder];
  if (Array.isArray(raw.lineOrder)) {
    const filtered: SubtitleLineRole[] = [];
    for (const item of raw.lineOrder) {
      if (
        typeof item === 'string' &&
        VALID_ROLES.includes(item as SubtitleLineRole) &&
        !filtered.includes(item as SubtitleLineRole)
      ) {
        filtered.push(item as SubtitleLineRole);
      }
    }
    if (filtered.length > 0) {
      lineOrder = filtered;
    }
  }

  const alignment: 2 | 8 =
    raw.alignment === 2 || raw.alignment === 8 ? raw.alignment : base.alignment;

  return {
    lineOrder,
    baseColor: normalizeHexColor(raw.baseColor, base.baseColor),
    targetColor: normalizeHexColor(raw.targetColor, base.targetColor),
    phoneticColor: normalizeHexColor(raw.phoneticColor, base.phoneticColor),
    baseFontSize: normalizeFiniteNumber(raw.baseFontSize, 8, 200, base.baseFontSize),
    targetFontSize: normalizeFiniteNumber(raw.targetFontSize, 8, 200, base.targetFontSize),
    phoneticFontSize: normalizeFiniteNumber(raw.phoneticFontSize, 8, 200, base.phoneticFontSize),
    fontFamily: normalizeFontFamily(raw.fontFamily, base.fontFamily),
    alignment,
    marginV: normalizeFiniteNumber(raw.marginV, 0, 400, base.marginV),
    outlineWidth: normalizeFiniteNumber(raw.outlineWidth, 0, 20, base.outlineWidth),
    shadowDepth: normalizeFiniteNumber(raw.shadowDepth, 0, 20, base.shadowDepth),
    opaqueBox: typeof raw.opaqueBox === 'boolean' ? raw.opaqueBox : base.opaqueBox,
    boxOpacity: normalizeFiniteNumber(raw.boxOpacity, 0, 100, base.boxOpacity),
    lineSpacing: normalizeFiniteNumber(raw.lineSpacing, 0, 100, base.lineSpacing),
    srtIncludeColorTags:
      typeof raw.srtIncludeColorTags === 'boolean'
        ? raw.srtIncludeColorTags
        : base.srtIncludeColorTags,
    srtIncludeBom:
      typeof raw.srtIncludeBom === 'boolean' ? raw.srtIncludeBom : base.srtIncludeBom,
  };
}

/**
 * Validates an incoming styleConfig patch (e.g. from PATCH /api/projects/:id).
 * Rejects wrong field types while returning a sanitized AssStyleConfig when valid.
 */
export function validateStyleConfigInput(
  raw: unknown,
  fallback: AssStyleConfig = DEFAULT_STYLE_CONFIG,
): { ok: true; value: AssStyleConfig } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'styleConfig must be a JSON object.' };
  }

  if (raw.lineOrder !== undefined) {
    if (!Array.isArray(raw.lineOrder) || raw.lineOrder.length === 0) {
      return { ok: false, error: 'styleConfig.lineOrder must be a non-empty array of line roles.' };
    }
    const invalidRole = raw.lineOrder.some(
      (r) => typeof r !== 'string' || !VALID_ROLES.includes(r as SubtitleLineRole),
    );
    if (invalidRole) {
      return {
        ok: false,
        error: 'styleConfig.lineOrder must contain only "base", "target", or "phonetic".',
      };
    }
  }

  for (const colorKey of ['baseColor', 'targetColor', 'phoneticColor'] as const) {
    if (raw[colorKey] !== undefined && !isValidHexColor(raw[colorKey])) {
      return { ok: false, error: `styleConfig.${colorKey} must be a valid #RGB or #RRGGBB hex color.` };
    }
  }

  for (const numKey of [
    'baseFontSize',
    'targetFontSize',
    'phoneticFontSize',
    'marginV',
    'outlineWidth',
    'shadowDepth',
    'boxOpacity',
    'lineSpacing',
  ] as const) {
    if (
      raw[numKey] !== undefined &&
      (typeof raw[numKey] !== 'number' || !Number.isFinite(raw[numKey]))
    ) {
      return { ok: false, error: `styleConfig.${numKey} must be a finite number.` };
    }
  }

  if (raw.alignment !== undefined && raw.alignment !== 2 && raw.alignment !== 8) {
    return { ok: false, error: 'styleConfig.alignment must be 2 (bottom) or 8 (top).' };
  }

  if (raw.fontFamily !== undefined && (typeof raw.fontFamily !== 'string' || !raw.fontFamily.trim())) {
    return { ok: false, error: 'styleConfig.fontFamily must be a non-empty string.' };
  }

  for (const boolKey of ['opaqueBox', 'srtIncludeColorTags', 'srtIncludeBom'] as const) {
    if (raw[boolKey] !== undefined && typeof raw[boolKey] !== 'boolean') {
      return { ok: false, error: `styleConfig.${boolKey} must be a boolean.` };
    }
  }

  return { ok: true, value: sanitizeStyleConfig(raw, fallback) };
}

export interface CueValidationOptions {
  /** Allow synthesizing missing (undefined) cue id/index when recovering persisted records. */
  allowSynthesizeIdentity?: boolean;
  /** Require at least one non-empty subtitle line per cue. */
  requireNonEmptyText?: boolean;
}

/**
 * Validates (and optionally normalizes omitted identity fields on) a single TriLineCue.
 */
export function validateTriLineCue(
  raw: unknown,
  fallbackIndex: number,
  options: CueValidationOptions = {},
): { ok: true; cue: TriLineCue } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: `Cue at position ${fallbackIndex} must be an object.` };
  }

  let id: string;
  if (raw.id === undefined && options.allowSynthesizeIdentity) {
    id = `cue-${fallbackIndex}`;
  } else if (typeof raw.id === 'string' && raw.id.trim().length > 0) {
    id = raw.id.trim();
  } else {
    return { ok: false, error: `Cue at position ${fallbackIndex} is missing a valid string id.` };
  }

  let index: number;
  if (raw.index === undefined && options.allowSynthesizeIdentity) {
    index = fallbackIndex;
  } else if (
    typeof raw.index === 'number' &&
    Number.isInteger(raw.index) &&
    raw.index >= 1
  ) {
    index = raw.index;
  } else {
    return {
      ok: false,
      error: `Cue at position ${fallbackIndex} must have a positive integer index.`,
    };
  }

  if (typeof raw.startMs !== 'number' || !Number.isFinite(raw.startMs) || raw.startMs < 0) {
    return {
      ok: false,
      error: `Cue #${index} has an invalid or negative startMs timestamp.`,
    };
  }

  if (typeof raw.endMs !== 'number' || !Number.isFinite(raw.endMs) || raw.endMs < raw.startMs) {
    return {
      ok: false,
      error: `Cue #${index} has an invalid endMs timestamp (must be >= startMs).`,
    };
  }

  if (
    typeof raw.baseText !== 'string' ||
    typeof raw.targetText !== 'string' ||
    typeof raw.phoneticText !== 'string'
  ) {
    return {
      ok: false,
      error: `Cue #${index} must include string baseText, targetText, and phoneticText fields.`,
    };
  }

  const requireNonEmpty = options.requireNonEmptyText ?? true;
  if (
    requireNonEmpty &&
    !raw.baseText.trim() &&
    !raw.targetText.trim() &&
    !raw.phoneticText.trim()
  ) {
    return {
      ok: false,
      error: `Cue #${index} has no subtitle text in baseText, targetText, or phoneticText.`,
    };
  }

  const cue: TriLineCue = {
    id,
    index,
    startMs: raw.startMs,
    endMs: raw.endMs,
    baseText: raw.baseText,
    targetText: raw.targetText,
    phoneticText: raw.phoneticText,
    ...(typeof raw.alignmentConfidence === 'number' && Number.isFinite(raw.alignmentConfidence)
      ? { alignmentConfidence: raw.alignmentConfidence }
      : {}),
    ...(typeof raw.alignmentRelationship === 'string'
      ? { alignmentRelationship: raw.alignmentRelationship as TriLineCue['alignmentRelationship'] }
      : {}),
    ...(typeof raw.cacheHit === 'boolean' ? { cacheHit: raw.cacheHit } : {}),
    ...(typeof raw.edited === 'boolean' ? { edited: raw.edited } : {}),
  };

  return { ok: true, cue };
}

/**
 * Validates cues specifically for export endpoints (/api/export/srt, /vtt, /ass).
 */
export function validateExportCues(
  cues: unknown,
): { ok: true; cues: TriLineCue[] } | { ok: false; error: string } {
  if (!Array.isArray(cues) || cues.length === 0) {
    return { ok: false, error: 'At least one valid subtitle cue is required for export.' };
  }

  const normalized: TriLineCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const res = validateTriLineCue(cues[i], i + 1, {
      allowSynthesizeIdentity: true,
      requireNonEmptyText: true,
    });
    if (!res.ok) {
      return res;
    }
    normalized.push(res.cue);
  }
  return { ok: true, cues: normalized };
}

function sanitizeIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return fallback;
}

function sanitizeProcessingReport(
  raw: unknown,
  cueCount: number,
  sourceFormat: SubtitleFormat,
): ProcessingReport {
  if (!isPlainObject(raw)) {
    return {
      detectedEncoding: 'UTF-8',
      originalFormat: sourceFormat,
      totalInputCues: cueCount,
      sdhStrippedCount: 0,
      duplicatesRemovedCount: 0,
      mergedLineCount: 0,
      finalCueCount: cueCount,
      sdhRemovedSamples: [],
    };
  }

  const format: SubtitleFormat =
    typeof raw.originalFormat === 'string' &&
    VALID_FORMATS.includes(raw.originalFormat as SubtitleFormat)
      ? (raw.originalFormat as SubtitleFormat)
      : sourceFormat;

  return {
    detectedEncoding:
      typeof raw.detectedEncoding === 'string' && raw.detectedEncoding.trim()
        ? raw.detectedEncoding
        : 'UTF-8',
    originalFormat: format,
    totalInputCues:
      typeof raw.totalInputCues === 'number' && Number.isFinite(raw.totalInputCues)
        ? Math.max(0, raw.totalInputCues)
        : cueCount,
    sdhStrippedCount:
      typeof raw.sdhStrippedCount === 'number' && Number.isFinite(raw.sdhStrippedCount)
        ? Math.max(0, raw.sdhStrippedCount)
        : 0,
    duplicatesRemovedCount:
      typeof raw.duplicatesRemovedCount === 'number' &&
      Number.isFinite(raw.duplicatesRemovedCount)
        ? Math.max(0, raw.duplicatesRemovedCount)
        : 0,
    mergedLineCount:
      typeof raw.mergedLineCount === 'number' && Number.isFinite(raw.mergedLineCount)
        ? Math.max(0, raw.mergedLineCount)
        : 0,
    finalCueCount:
      typeof raw.finalCueCount === 'number' && Number.isFinite(raw.finalCueCount)
        ? Math.max(0, raw.finalCueCount)
        : cueCount,
    ...(typeof raw.overlappingCueCount === 'number' && Number.isFinite(raw.overlappingCueCount)
      ? { overlappingCueCount: Math.max(0, raw.overlappingCueCount) }
      : {}),
    sdhRemovedSamples: Array.isArray(raw.sdhRemovedSamples)
      ? raw.sdhRemovedSamples.filter((s): s is string => typeof s === 'string')
      : [],
    ...(isPlainObject(raw.alignmentStats)
      ? { alignmentStats: raw.alignmentStats as unknown as ProcessingReport['alignmentStats'] }
      : {}),
  };
}

/**
 * Validates and sanitizes a SavedProject.
 * - In strict mode (`forPersistenceLoad: false`, used on saveProject): rejects malformed
 *   cue identities, invalid styleConfig types, missing languages/titles, or wrong field types.
 * - In recovery mode (`forPersistenceLoad: true`, used when reading persisted JSON from disk):
 *   rejects genuinely broken/unrecoverable projects while safely recovering projects that only
 *   have malformed/partial styleConfig, missing optional metadata, or omitted cue id/index.
 */
export function validateAndNormalizeProject(
  raw: unknown,
  options: { forPersistenceLoad?: boolean } = {},
): { ok: true; project: SavedProject } | { ok: false; error: string } {
  const recovery = Boolean(options.forPersistenceLoad);

  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Project must be a JSON object.' };
  }

  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    return { ok: false, error: 'Project id must be a non-empty string.' };
  }

  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return { ok: false, error: 'Project title must be a non-empty string.' };
  }

  if (typeof raw.baseLang !== 'string' || !raw.baseLang.trim()) {
    return { ok: false, error: 'Project baseLang metadata is required.' };
  }

  if (typeof raw.targetLang !== 'string' || !raw.targetLang.trim()) {
    return { ok: false, error: 'Project targetLang metadata is required.' };
  }

  if (!Array.isArray(raw.cues)) {
    return { ok: false, error: 'Project cues must be an array.' };
  }

  const normalizedCues: TriLineCue[] = [];
  for (let i = 0; i < raw.cues.length; i++) {
    const cueResult = validateTriLineCue(raw.cues[i], i + 1, {
      allowSynthesizeIdentity: recovery,
      requireNonEmptyText: true,
    });
    if (!cueResult.ok) {
      return cueResult;
    }
    normalizedCues.push(cueResult.cue);
  }

  // Validate or recover styleConfig
  let styleConfig: AssStyleConfig;
  if (recovery) {
    styleConfig = sanitizeStyleConfig(raw.styleConfig, DEFAULT_STYLE_CONFIG);
  } else {
    if (raw.styleConfig === undefined) {
      styleConfig = { ...DEFAULT_STYLE_CONFIG, lineOrder: [...DEFAULT_STYLE_CONFIG.lineOrder] };
    } else {
      const styleCheck = validateStyleConfigInput(raw.styleConfig, DEFAULT_STYLE_CONFIG);
      if (!styleCheck.ok) {
        return styleCheck;
      }
      styleConfig = styleCheck.value;
    }
  }

  // Validate mode / phoneticStyle / sourceFormat
  if (
    !recovery &&
    raw.mode !== undefined &&
    (typeof raw.mode !== 'string' || !VALID_MODES.includes(raw.mode as ConversionMode))
  ) {
    return { ok: false, error: 'Project mode is invalid.' };
  }
  const mode: ConversionMode =
    typeof raw.mode === 'string' && VALID_MODES.includes(raw.mode as ConversionMode)
      ? (raw.mode as ConversionMode)
      : 'target-first';

  if (
    !recovery &&
    raw.phoneticStyle !== undefined &&
    (typeof raw.phoneticStyle !== 'string' ||
      !VALID_PHONETIC_STYLES.includes(raw.phoneticStyle as PhoneticStyle))
  ) {
    return { ok: false, error: 'Project phoneticStyle is invalid.' };
  }
  const phoneticStyle: PhoneticStyle =
    typeof raw.phoneticStyle === 'string' &&
    VALID_PHONETIC_STYLES.includes(raw.phoneticStyle as PhoneticStyle)
      ? (raw.phoneticStyle as PhoneticStyle)
      : 'hyphenated';

  const translationStyle: TranslationStyle | undefined =
    typeof raw.translationStyle === 'string' &&
    VALID_TRANSLATION_STYLES.includes(raw.translationStyle as TranslationStyle)
      ? (raw.translationStyle as TranslationStyle)
      : undefined;

  const sourceFormat: SubtitleFormat =
    typeof raw.sourceFormat === 'string' &&
    VALID_FORMATS.includes(raw.sourceFormat as SubtitleFormat)
      ? (raw.sourceFormat as SubtitleFormat)
      : 'srt';

  const now = new Date().toISOString();
  const createdAt = sanitizeIsoTimestamp(raw.createdAt, now);
  const updatedAt = sanitizeIsoTimestamp(raw.updatedAt, createdAt);

  const cacheKey =
    typeof raw.cacheKey === 'string' && raw.cacheKey.trim()
      ? raw.cacheKey.trim()
      : `legacy-${raw.id.trim()}`;

  const sourceFileName =
    typeof raw.sourceFileName === 'string' && raw.sourceFileName.trim()
      ? raw.sourceFileName.trim()
      : `${raw.title.trim()}.${sourceFormat}`;

  const project: SavedProject = {
    id: raw.id.trim(),
    cacheKey,
    title: raw.title.trim(),
    ...(typeof raw.movieId === 'string' && raw.movieId.trim() ? { movieId: raw.movieId.trim() } : {}),
    ...(typeof raw.posterUrl === 'string' && raw.posterUrl.trim()
      ? { posterUrl: raw.posterUrl.trim() }
      : {}),
    ...(typeof raw.releaseYear === 'string' && raw.releaseYear.trim()
      ? { releaseYear: raw.releaseYear.trim() }
      : {}),
    ...(raw.mediaType === 'movie' || raw.mediaType === 'tv' ? { mediaType: raw.mediaType } : {}),
    baseLang: raw.baseLang.trim(),
    targetLang: raw.targetLang.trim(),
    mode,
    phoneticStyle,
    ...(translationStyle ? { translationStyle } : {}),
    sourceFileName,
    sourceFormat,
    createdAt,
    updatedAt,
    cues: normalizedCues,
    processingReport: sanitizeProcessingReport(raw.processingReport, normalizedCues.length, sourceFormat),
    styleConfig,
  };

  return { ok: true, project };
}

/**
 * Sanitizes a user-supplied export filename for Content-Disposition headers,
 * stripping directory traversal, leading dots, invalid characters, and excessive length.
 */
export function sanitizeExportFileName(fileName: unknown): string {
  if (typeof fileName !== 'string') {
    return 'triline_subtitles';
  }
  // Take only the last path segment (handles both / and \)
  const baseSegment = fileName.split(/[\\/]/).pop() || '';
  // Strip existing subtitle / triline extensions to avoid doubled suffixes like movie.srt.triline.srt
  const strippedExt = baseSegment.replace(/(?:\.triline)?\.(?:srt|vtt|ass|ssa)$/i, '');
  const cleaned = strippedExt
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100);
  return cleaned || 'triline_subtitles';
}
