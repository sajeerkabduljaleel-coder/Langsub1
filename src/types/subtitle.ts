export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export type ConversionMode = 'target-first' | 'base-first' | 'dual-merge';

export type PhoneticStyle = 'hyphenated' | 'flowing' | 'standard';

export type TranslationStyle = 'natural' | 'literal' | 'colloquial' | 'formal';

export interface LearningControlsConfig {
  showBase: boolean;
  showTarget: boolean;
  showPhonetic: boolean;
  highlightWords: boolean;
  playbackSpeed: number;
  pauseBetweenCuesMs: number;
  repeatCurrentCue: boolean;
}

export const DEFAULT_LEARNING_CONTROLS: LearningControlsConfig = {
  showBase: true,
  showTarget: true,
  showPhonetic: true,
  highlightWords: false,
  playbackSpeed: 1,
  pauseBetweenCuesMs: 0,
  repeatCurrentCue: false,
};

export interface ProcessingOptions {
  removeSdh: boolean;
  mergeMultiline: boolean;
  removeDuplicates: boolean;
  preserveFormattingTags: boolean;
}

export interface RawCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  originalText: string;
}

export type AlignmentRelationship =
  | 'exact'
  | 'interpolated'
  | 'one-to-many'
  | 'many-to-one'
  | 'unmatched-target'
  | 'unmatched-base'
  | 'manual';

export interface TriLineCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  baseText: string;
  targetText: string;
  phoneticText: string;
  alignmentConfidence?: number;
  alignmentRelationship?: AlignmentRelationship;
  cacheHit?: boolean;
  edited?: boolean;
}

export type SubtitleLineRole = 'base' | 'target' | 'phonetic';

export interface AssStyleConfig {
  lineOrder: SubtitleLineRole[];
  baseColor: string;
  targetColor: string;
  phoneticColor: string;
  baseFontSize: number;
  targetFontSize: number;
  phoneticFontSize: number;
  fontFamily: string;
  alignment: 2 | 8;
  marginV: number;
  outlineWidth: number;
  shadowDepth: number;
  opaqueBox: boolean;
  boxOpacity: number;
  lineSpacing: number;
  srtIncludeColorTags: boolean;
  srtIncludeBom: boolean;
}

export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = {
  removeSdh: true,
  mergeMultiline: true,
  removeDuplicates: true,
  preserveFormattingTags: false,
};

export const DEFAULT_STYLE_CONFIG: AssStyleConfig = {
  lineOrder: ['base', 'target', 'phonetic'],
  baseColor: '#FFFFFF',
  targetColor: '#FACC15',
  phoneticColor: '#22D3EE',
  baseFontSize: 42,
  targetFontSize: 48,
  phoneticFontSize: 38,
  fontFamily: 'Plus Jakarta Sans',
  alignment: 2,
  marginV: 44,
  outlineWidth: 2.5,
  shadowDepth: 1,
  opaqueBox: true,
  boxOpacity: 55,
  lineSpacing: 6,
  srtIncludeColorTags: false,
  srtIncludeBom: true,
};

export interface AlignmentStats {
  exactMatches: number;
  interpolatedMatches: number;
  oneToManyMatches: number;
  manyToOneMatches: number;
  unmatchedTarget: number;
  unmatchedBase: number;
  uncertainCount: number;
  averageConfidence: number;
  estimatedOffsetMs: number;
  overlappingCues?: number;
}

export interface AlignedCuePair {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  targetText: string;
  baseText: string;
  confidence: number;
  relationship: AlignmentRelationship;
  uncertain: boolean;
  matchedTargetIndices: number[];
  matchedBaseIndices: number[];
}

export interface UnmatchedBaseCue {
  index: number;
  startMs: number;
  endMs: number;
  shiftedStartMs: number;
  shiftedEndMs: number;
  text: string;
}

export interface AlignmentPreviewData {
  aligned: AlignedCuePair[];
  unmatchedBaseCues: UnmatchedBaseCue[];
  stats: AlignmentStats;
}

export interface ProcessingReport {
  detectedEncoding: string;
  originalFormat: SubtitleFormat;
  totalInputCues: number;
  sdhStrippedCount: number;
  duplicatesRemovedCount: number;
  mergedLineCount: number;
  finalCueCount: number;
  overlappingCueCount?: number;
  sdhRemovedSamples: string[];
  alignmentStats?: AlignmentStats;
}

export interface ParsedSubtitleResult {
  cues: RawCue[];
  report: ProcessingReport;
  sourceHash: string;
  fileName: string;
}

export interface ConversionJob {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  mode: ConversionMode;
  baseLang: string;
  targetLang: string;
  phoneticStyle: PhoneticStyle;
  translationStyle?: TranslationStyle;
  totalCues: number;
  processedCues: number;
  cacheHits: number;
  apiBatchesCompleted: number;
  apiBatchesTotal: number;
  estimatedRemainingSec: number;
  fromProjectCache?: boolean;
  error?: string;
  projectId?: string;
}

export interface MovieMetadata {
  movieId?: string;
  title: string;
  releaseYear?: string;
  posterUrl?: string;
  overview?: string;
  mediaType?: 'movie' | 'tv';
  originalLanguage?: string;
}

export interface SavedProject {
  id: string;
  cacheKey: string;
  title: string;
  movieId?: string;
  posterUrl?: string;
  releaseYear?: string;
  mediaType?: 'movie' | 'tv';
  baseLang: string;
  targetLang: string;
  mode: ConversionMode;
  phoneticStyle: PhoneticStyle;
  translationStyle?: TranslationStyle;
  sourceFileName: string;
  sourceFormat: SubtitleFormat;
  createdAt: string;
  updatedAt: string;
  cues: TriLineCue[];
  processingReport: ProcessingReport;
  styleConfig: AssStyleConfig;
}

export interface TmdbSearchItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  releaseYear: string;
  posterUrl: string | null;
  overview: string;
  originalLanguage: string;
  voteAverage: number;
}

export type SubtitleProviderId = 'opensubtitles' | 'subdl';

export interface ProviderSubtitleItem {
  id: string;
  provider: SubtitleProviderId;
  providerLabel: string;
  title: string;
  fileName: string;
  language: string;
  mediaInfo?: string;
  season?: number;
  episode?: number;
  release: string;
  releaseYear?: string;
  format: string;
  downloadable: boolean;
  downloadCount?: number;
  hearingImpaired: boolean;
  downloadRef: string;
  alsoOnProviders?: SubtitleProviderId[];
}

export type ProviderErrorCode =
  | 'unconfigured'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'upstream'
  | 'network';

export interface ProviderSearchOutcome {
  provider: SubtitleProviderId;
  providerLabel: string;
  configured: boolean;
  ok: boolean;
  results: ProviderSubtitleItem[];
  message?: string;
  error?: string;
  errorCode?: ProviderErrorCode;
}

export interface MultiProviderSearchResponse {
  opensubtitles?: ProviderSearchOutcome;
  subdl?: ProviderSearchOutcome;
  duplicatesRemoved: number;
}

export type IntegrationProviderId = 'gemini' | 'tmdb' | 'opensubtitles' | 'subdl';

export type VerificationStatus = 'unconfigured' | 'untested' | 'verified' | 'failed';

export interface ProviderDiagnostic {
  provider: IntegrationProviderId;
  name: string;
  configured: boolean;
  authMode: string;
  verificationStatus: VerificationStatus;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

export interface IntegrationsStatus {
  gemini: boolean;
  tmdb: boolean;
  opensubtitles: boolean;
  subdl: boolean;
  tmdbAuthMode?: 'bearer_token' | 'v3_api_key' | 'none';
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Mandarin Chinese' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
] as const;
