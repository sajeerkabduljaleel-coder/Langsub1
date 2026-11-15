import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { GoogleGenAI } from '@google/genai';
import type {
  IntegrationProviderId,
  IntegrationsStatus,
  MultiProviderSearchResponse,
  ProviderDiagnostic,
  ProviderErrorCode,
  ProviderSearchOutcome,
  ProviderSubtitleItem,
  SubtitleProviderId,
  TmdbSearchItem,
  VerificationStatus,
} from '../../src/types/subtitle.ts';
import { DEFAULT_GEMINI_MODEL } from '../db/store.ts';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10000;

export interface ProviderDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  geminiCheckFn?: (apiKey: string) => Promise<void>;
}

export class ProviderRequestError extends Error {
  readonly statusCode?: number;
  readonly errorCode: ProviderErrorCode;

  constructor(message: string, errorCode: ProviderErrorCode, statusCode?: number) {
    super(message);
    this.name = 'ProviderRequestError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
  }
}

interface ProviderRuntimeState {
  verificationStatus: Exclude<VerificationStatus, 'unconfigured'> | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

const runtimeDiagnostics: Record<IntegrationProviderId, ProviderRuntimeState> = {
  gemini: { verificationStatus: null, lastCheckedAt: null, lastSuccessAt: null, error: null },
  tmdb: { verificationStatus: null, lastCheckedAt: null, lastSuccessAt: null, error: null },
  opensubtitles: { verificationStatus: null, lastCheckedAt: null, lastSuccessAt: null, error: null },
  subdl: { verificationStatus: null, lastCheckedAt: null, lastSuccessAt: null, error: null },
};

export function resetDiagnosticsForTests(): void {
  for (const key of Object.keys(runtimeDiagnostics) as IntegrationProviderId[]) {
    runtimeDiagnostics[key] = {
      verificationStatus: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      error: null,
    };
  }
}

function recordProviderSuccess(provider: IntegrationProviderId): void {
  const now = new Date().toISOString();
  runtimeDiagnostics[provider] = {
    verificationStatus: 'verified',
    lastCheckedAt: now,
    lastSuccessAt: now,
    error: null,
  };
}

function recordProviderFailure(provider: IntegrationProviderId, message: string): void {
  const now = new Date().toISOString();
  runtimeDiagnostics[provider] = {
    ...runtimeDiagnostics[provider],
    verificationStatus: 'failed',
    lastCheckedAt: now,
    error: sanitizeProviderMessage(message),
  };
}

function getConfiguredSecrets(): string[] {
  return [
    process.env.GEMINI_API_KEY,
    process.env.TMDB_READ_ACCESS_TOKEN,
    process.env.TMDB_V3_API_KEY,
    process.env.TMDB_API_KEY,
    process.env.OPENSUBTITLES_API_KEY,
    process.env.SUBDL_API_KEY,
  ]
    .map((v) => v?.trim() || '')
    .filter((v) => v.length >= 6);
}

/**
 * Strips any API keys, Bearer tokens, or api_key query parameters before surfacing errors or logging.
 */
export function sanitizeProviderMessage(raw: string): string {
  let msg = raw || 'Unknown provider error.';
  for (const secret of getConfiguredSecrets()) {
    if (msg.includes(secret)) {
      msg = msg.split(secret).join('[REDACTED]');
    }
  }
  msg = msg.replace(/([?&]api_key=)[^&\s"']+/gi, '$1[REDACTED]');
  msg = msg.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
  msg = msg.replace(/(Api-Key:\s*)[^\s"']+/gi, '$1[REDACTED]');
  return msg.trim();
}

function isJwtToken(value: string): boolean {
  return /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}$/.test(value);
}

export interface ResolvedTmdbAuth {
  configured: boolean;
  mode: 'bearer_token' | 'v3_api_key' | 'none';
  secret: string;
  sourceVar: 'TMDB_READ_ACCESS_TOKEN' | 'TMDB_V3_API_KEY' | 'TMDB_API_KEY' | null;
  label: string;
}

export function resolveTmdbAuth(): ResolvedTmdbAuth {
  const readToken = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  if (readToken) {
    return {
      configured: true,
      mode: 'bearer_token',
      secret: readToken,
      sourceVar: 'TMDB_READ_ACCESS_TOKEN',
      label: 'Bearer Read Access Token (TMDB_READ_ACCESS_TOKEN)',
    };
  }

  const explicitV3 = process.env.TMDB_V3_API_KEY?.trim();
  if (explicitV3) {
    return {
      configured: true,
      mode: 'v3_api_key',
      secret: explicitV3,
      sourceVar: 'TMDB_V3_API_KEY',
      label: 'v3 API Key (TMDB_V3_API_KEY)',
    };
  }

  const legacyKey = process.env.TMDB_API_KEY?.trim();
  if (legacyKey) {
    if (isJwtToken(legacyKey)) {
      return {
        configured: true,
        mode: 'bearer_token',
        secret: legacyKey,
        sourceVar: 'TMDB_API_KEY',
        label: 'Bearer Read Access Token (legacy TMDB_API_KEY)',
      };
    }
    return {
      configured: true,
      mode: 'v3_api_key',
      secret: legacyKey,
      sourceVar: 'TMDB_API_KEY',
      label: 'v3 API Key (TMDB_API_KEY)',
    };
  }

  return {
    configured: false,
    mode: 'none',
    secret: '',
    sourceVar: null,
    label: 'Not configured',
  };
}

export function getIntegrationsStatus(): IntegrationsStatus {
  const tmdbAuth = resolveTmdbAuth();
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    tmdb: tmdbAuth.configured,
    opensubtitles: Boolean(process.env.OPENSUBTITLES_API_KEY?.trim()),
    subdl: Boolean(process.env.SUBDL_API_KEY?.trim()),
    tmdbAuthMode: tmdbAuth.mode,
  };
}

export function getIntegrationsDiagnostics(): ProviderDiagnostic[] {
  const tmdbAuth = resolveTmdbAuth();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const osConfigured = Boolean(process.env.OPENSUBTITLES_API_KEY?.trim());
  const subdlConfigured = Boolean(process.env.SUBDL_API_KEY?.trim());

  const defs: Array<{
    provider: IntegrationProviderId;
    name: string;
    configured: boolean;
    authMode: string;
  }> = [
    {
      provider: 'gemini',
      name: 'Google Gemini AI',
      configured: geminiConfigured,
      authMode: geminiConfigured
        ? `Server API Key (GEMINI_API_KEY · ${DEFAULT_GEMINI_MODEL})`
        : 'Not configured',
    },
    {
      provider: 'tmdb',
      name: 'TMDB',
      configured: tmdbAuth.configured,
      authMode: tmdbAuth.label,
    },
    {
      provider: 'opensubtitles',
      name: 'OpenSubtitles',
      configured: osConfigured,
      authMode: osConfigured ? 'API Key + User-Agent (OPENSUBTITLES_API_KEY)' : 'Not configured',
    },
    {
      provider: 'subdl',
      name: 'SubDL',
      configured: subdlConfigured,
      authMode: subdlConfigured ? 'API Key (SUBDL_API_KEY)' : 'Not configured',
    },
  ];

  return defs.map((def) => {
    const state = runtimeDiagnostics[def.provider];
    const verificationStatus: VerificationStatus = !def.configured
      ? 'unconfigured'
      : state.verificationStatus || 'untested';
    return {
      provider: def.provider,
      name: def.name,
      configured: def.configured,
      authMode: def.authMode,
      verificationStatus,
      lastCheckedAt: state.lastCheckedAt,
      lastSuccessAt: state.lastSuccessAt,
      error: def.configured ? state.error : state.error || null,
    };
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  deps?: ProviderDeps,
): Promise<Response> {
  const fetchFn = deps?.fetchFn || globalThis.fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const externalSignal = init?.signal;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (
      controller.signal.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
    ) {
      throw new ProviderRequestError(
        `Request timed out after ${timeoutMs}ms.`,
        'timeout',
      );
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    throw new ProviderRequestError(
      `Network connection error: ${sanitizeProviderMessage(rawMsg)}`,
      'network',
    );
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function buildHttpError(
  providerName: string,
  res: Response,
  rawBody: string,
  authHint: string,
): ProviderRequestError {
  const safeBody = sanitizeProviderMessage(rawBody).slice(0, 220);
  if (res.status === 401 || res.status === 403) {
    return new ProviderRequestError(
      `${providerName} authentication failed (HTTP ${res.status}). ${authHint}`,
      'auth',
      res.status,
    );
  }
  if (res.status === 429) {
    const retryAfter = res.headers?.get?.('retry-after');
    const retryHint = retryAfter ? ` Retry after ${retryAfter}s.` : '';
    return new ProviderRequestError(
      `${providerName} rate limit exceeded (HTTP 429).${retryHint} Please wait before retrying.`,
      'rate_limit',
      429,
    );
  }
  if (res.status >= 500) {
    return new ProviderRequestError(
      `${providerName} service is temporarily unavailable (HTTP ${res.status}).`,
      'upstream',
      res.status,
    );
  }
  return new ProviderRequestError(
    `${providerName} request failed (HTTP ${res.status})${safeBody ? `: ${safeBody}` : '.'}`,
    'upstream',
    res.status,
  );
}

const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  english: 'en',
  eng: 'en',
  german: 'de',
  deutsch: 'de',
  deu: 'de',
  ger: 'de',
  spanish: 'es',
  espanol: 'es',
  spa: 'es',
  french: 'fr',
  francais: 'fr',
  fra: 'fr',
  fre: 'fr',
  japanese: 'ja',
  jpn: 'ja',
  korean: 'ko',
  kor: 'ko',
  chinese: 'zh',
  mandarin: 'zh',
  'mandarin chinese': 'zh',
  zho: 'zh',
  chi: 'zh',
  italian: 'it',
  ita: 'it',
  portuguese: 'pt',
  por: 'pt',
  russian: 'ru',
  rus: 'ru',
  arabic: 'ar',
  ara: 'ar',
  hindi: 'hi',
  hin: 'hi',
  dutch: 'nl',
  nld: 'nl',
  dut: 'nl',
  swedish: 'sv',
  swe: 'sv',
  turkish: 'tr',
  tur: 'tr',
  polish: 'pl',
  pol: 'pl',
};

export function normalizeLanguageCode(raw?: string): string {
  const cleaned = (raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (!cleaned) return 'unknown';
  if (LANGUAGE_NAME_TO_CODE[cleaned]) {
    return LANGUAGE_NAME_TO_CODE[cleaned];
  }
  return cleaned;
}

function detectFormat(candidates: Array<string | undefined>): string {
  for (const cand of candidates) {
    if (!cand) continue;
    const match = cand.trim().match(/\.(srt|vtt|ass|ssa|sub)(?:$|\?)/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return 'srt';
}

function extractEpisodeMeta(text?: string): { season?: number; episode?: number } {
  if (!text) return {};
  const match = text.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  if (!match) return {};
  return {
    season: Number(match[1]),
    episode: Number(match[2]),
  };
}

function extractYearFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/(?:^|[\s._(-])(19\d{2}|20\d{2})(?:$|[\s._)-])/);
  return match ? match[1] : undefined;
}

function formatEpisodeLabel(season?: number, episode?: number): string | undefined {
  if (typeof season === 'number' && typeof episode === 'number') {
    return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  }
  if (typeof season === 'number') {
    return `Season ${season}`;
  }
  return undefined;
}

function buildStableSubtitleId(provider: SubtitleProviderId, keyParts: string[]): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${provider}:${keyParts.join('|')}`)
    .digest('hex')
    .slice(0, 12);
  return `${provider}-${hash}`;
}

function normalizeReleaseKey(item: ProviderSubtitleItem): string {
  const baseRelease = (item.release || item.fileName || item.title)
    .toLowerCase()
    .replace(/\.(srt|vtt|ass|ssa|sub|zip)$/i, '')
    .replace(/[\s._\-\[\]()]+/g, ' ')
    .trim();
  const hiFlag = item.hearingImpaired ? 'hi' : 'std';
  return `${item.language}|${item.format}|${hiFlag}|${baseRelease}`;
}

export function deduplicateProviderResults(items: ProviderSubtitleItem[]): {
  deduplicated: ProviderSubtitleItem[];
  duplicatesRemoved: number;
} {
  const chosenByKey = new Map<string, ProviderSubtitleItem>();
  let duplicatesRemoved = 0;

  for (const item of items) {
    const key = normalizeReleaseKey(item);
    const existing = chosenByKey.get(key);
    if (!existing) {
      chosenByKey.set(key, { ...item });
      continue;
    }

    duplicatesRemoved++;
    const providersSet = new Set<SubtitleProviderId>([
      existing.provider,
      ...(existing.alsoOnProviders || []),
      item.provider,
      ...(item.alsoOnProviders || []),
    ]);
    const alsoOnProviders = Array.from(providersSet);

    // Prefer downloadable item, then higher download count, then richer metadata
    const existingScore =
      (existing.downloadable ? 100 : 0) +
      (existing.mediaInfo ? 5 : 0) +
      (existing.releaseYear ? 2 : 0) +
      Math.min(20, (existing.downloadCount || 0) / 1000);
    const candidateScore =
      (item.downloadable ? 100 : 0) +
      (item.mediaInfo ? 5 : 0) +
      (item.releaseYear ? 2 : 0) +
      Math.min(20, (item.downloadCount || 0) / 1000);

    const winner = candidateScore > existingScore ? { ...item } : { ...existing };
    if (alsoOnProviders.length > 1) {
      winner.alsoOnProviders = alsoOnProviders;
    }
    chosenByKey.set(key, winner);
  }

  return {
    deduplicated: Array.from(chosenByKey.values()),
    duplicatesRemoved,
  };
}

export async function searchTmdb(
  query: string,
  deps?: ProviderDeps,
): Promise<{
  configured: boolean;
  results: TmdbSearchItem[];
  message?: string;
}> {
  const auth = resolveTmdbAuth();
  if (!auth.configured) {
    return {
      configured: false,
      results: [],
      message:
        'TMDB is not configured. Set TMDB_READ_ACCESS_TOKEN (recommended) or TMDB_API_KEY in environment secrets, or upload subtitle files directly.',
    };
  }

  const url = new URL('https://api.themoviedb.org/3/search/multi');
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('language', 'en-US');
  if (auth.mode === 'v3_api_key') {
    url.searchParams.set('api_key', auth.secret);
  }

  try {
    const res = await fetchWithTimeout(
      url.toString(),
      {
        headers:
          auth.mode === 'bearer_token'
            ? { Authorization: `Bearer ${auth.secret}`, Accept: 'application/json' }
            : { Accept: 'application/json' },
      },
      deps,
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw buildHttpError(
        'TMDB',
        res,
        errText,
        'Verify your TMDB_READ_ACCESS_TOKEN (Bearer) or TMDB_API_KEY (v3).',
      );
    }

    const data = (await res.json()) as {
      results?: Array<{
        id: number;
        media_type: string;
        title?: string;
        name?: string;
        original_title?: string;
        original_name?: string;
        release_date?: string;
        first_air_date?: string;
        poster_path?: string | null;
        overview?: string;
        original_language?: string;
        vote_average?: number;
      }>;
    };

    const items: TmdbSearchItem[] = (data.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 12)
      .map((r) => {
        const dateStr = r.release_date || r.first_air_date || '';
        return {
          id: r.id,
          mediaType: r.media_type === 'tv' ? 'tv' : 'movie',
          title: r.title || r.name || 'Untitled',
          originalTitle: r.original_title || r.original_name,
          releaseYear: dateStr ? dateStr.slice(0, 4) : '',
          posterUrl: r.poster_path
            ? `https://image.tmdb.org/t/p/w342${r.poster_path}`
            : null,
          overview: r.overview || '',
          originalLanguage: r.original_language || 'en',
          voteAverage: Number((r.vote_average || 0).toFixed(1)),
        };
      });

    recordProviderSuccess('tmdb');
    return { configured: true, results: items };
  } catch (err: unknown) {
    const safeErr =
      err instanceof ProviderRequestError
        ? err
        : new ProviderRequestError(
            sanitizeProviderMessage(err instanceof Error ? err.message : 'TMDB search failed.'),
            'network',
          );
    recordProviderFailure('tmdb', safeErr.message);
    throw safeErr;
  }
}

export async function searchOpenSubtitles(
  params: {
    query?: string;
    tmdbId?: string;
    language?: string;
  },
  deps?: ProviderDeps,
): Promise<ProviderSearchOutcome> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY?.trim();
  if (!apiKey) {
    return {
      provider: 'opensubtitles',
      providerLabel: 'OpenSubtitles',
      configured: false,
      ok: false,
      results: [],
      errorCode: 'unconfigured',
      message: 'OPENSUBTITLES_API_KEY is not configured in server secrets.',
    };
  }

  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  if (params.tmdbId) url.searchParams.set('tmdb_id', params.tmdbId);
  if (params.query) url.searchParams.set('query', params.query);
  if (params.language && params.language !== 'all') {
    url.searchParams.set('languages', normalizeLanguageCode(params.language));
  }

  try {
    const res = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          'Api-Key': apiKey,
          'User-Agent': process.env.OPENSUBTITLES_USER_AGENT?.trim() || 'TriLineStudio v1.0',
          Accept: 'application/json',
        },
      },
      deps,
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw buildHttpError(
        'OpenSubtitles',
        res,
        errText,
        'Verify OPENSUBTITLES_API_KEY and OPENSUBTITLES_USER_AGENT.',
      );
    }

    const data = (await res.json()) as {
      data?: Array<{
        id: string | number;
        attributes?: {
          language?: string;
          release?: string;
          format?: string;
          download_count?: number;
          hearing_impaired?: boolean;
          feature_details?: {
            title?: string;
            movie_name?: string;
            parent_title?: string;
            year?: number | string;
            feature_type?: string;
            season_number?: number;
            episode_number?: number;
          };
          files?: Array<{ file_id?: number; file_name?: string }>;
        };
      }>;
    };

    const results: ProviderSubtitleItem[] = [];
    for (const item of data.data || []) {
      const attrs = item.attributes || {};
      const file = attrs.files?.[0];
      const feature = attrs.feature_details;
      const release =
        attrs.release?.trim() ||
        file?.file_name?.trim() ||
        feature?.movie_name ||
        feature?.title ||
        'OpenSubtitles release';
      const format = detectFormat([
        attrs.format ? `x.${attrs.format}` : undefined,
        file?.file_name,
        release,
      ]);
      const fileName =
        file?.file_name?.trim() ||
        (/\.(srt|vtt|ass|ssa|sub)$/i.test(release) ? release : `${release}.${format}`);
      const epParsed = extractEpisodeMeta(release);
      const season = feature?.season_number ?? epParsed.season;
      const episode = feature?.episode_number ?? epParsed.episode;
      const epTag = formatEpisodeLabel(season, episode);
      const parentOrMovie = feature?.parent_title || feature?.movie_name || feature?.title;
      const mediaInfo = epTag
        ? parentOrMovie
          ? `${parentOrMovie} · ${epTag}`
          : epTag
        : feature?.feature_type || (parentOrMovie && parentOrMovie !== release ? parentOrMovie : undefined);
      const releaseYear = feature?.year
        ? String(feature.year)
        : extractYearFromText(release) || extractYearFromText(feature?.movie_name);
      const downloadable = Boolean(file?.file_id);

      results.push({
        id: `os-${item.id}`,
        provider: 'opensubtitles',
        providerLabel: 'OpenSubtitles',
        title: feature?.movie_name || feature?.title || release,
        fileName,
        language: normalizeLanguageCode(attrs.language || params.language),
        ...(mediaInfo ? { mediaInfo } : {}),
        ...(typeof season === 'number' ? { season } : {}),
        ...(typeof episode === 'number' ? { episode } : {}),
        release,
        ...(releaseYear ? { releaseYear } : {}),
        format,
        downloadable,
        downloadCount: attrs.download_count,
        hearingImpaired: Boolean(attrs.hearing_impaired),
        downloadRef: downloadable ? String(file!.file_id) : '',
      });
    }

    recordProviderSuccess('opensubtitles');
    return {
      provider: 'opensubtitles',
      providerLabel: 'OpenSubtitles',
      configured: true,
      ok: true,
      results: results.slice(0, 25),
    };
  } catch (err: unknown) {
    const safeErr =
      err instanceof ProviderRequestError
        ? err
        : new ProviderRequestError(
            sanitizeProviderMessage(
              err instanceof Error ? err.message : 'OpenSubtitles search failed.',
            ),
            'network',
          );
    recordProviderFailure('opensubtitles', safeErr.message);
    throw safeErr;
  }
}

export async function downloadOpenSubtitleFile(
  fileId: string,
  deps?: ProviderDeps,
): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderRequestError('OPENSUBTITLES_API_KEY is not configured.', 'unconfigured');
  }
  if (!fileId || Number.isNaN(Number(fileId))) {
    throw new ProviderRequestError('Invalid OpenSubtitles file ID.', 'upstream', 400);
  }

  const res = await fetchWithTimeout(
    'https://api.opensubtitles.com/api/v1/download',
    {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'User-Agent': process.env.OPENSUBTITLES_USER_AGENT?.trim() || 'TriLineStudio v1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ file_id: Number(fileId) }),
    },
    deps,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw buildHttpError(
      'OpenSubtitles',
      res,
      errText,
      'Verify OPENSUBTITLES_API_KEY and download quota.',
    );
  }

  const data = (await res.json()) as { link?: string; file_name?: string; message?: string };
  if (!data.link) {
    throw new ProviderRequestError(
      sanitizeProviderMessage(
        data.message || 'OpenSubtitles did not return a download URL.',
      ),
      'upstream',
    );
  }

  const fileRes = await fetchWithTimeout(data.link, undefined, deps);
  if (!fileRes.ok) {
    throw new ProviderRequestError(
      `Failed to download OpenSubtitles subtitle payload (HTTP ${fileRes.status}).`,
      'upstream',
      fileRes.status,
    );
  }

  const arrBuf = await fileRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrBuf),
    fileName: data.file_name || `opensubtitles_${fileId}.srt`,
  };
}

export async function searchSubdl(
  params: {
    query?: string;
    tmdbId?: string;
    language?: string;
  },
  deps?: ProviderDeps,
): Promise<ProviderSearchOutcome> {
  const apiKey = process.env.SUBDL_API_KEY?.trim();
  if (!apiKey) {
    return {
      provider: 'subdl',
      providerLabel: 'SubDL',
      configured: false,
      ok: false,
      results: [],
      errorCode: 'unconfigured',
      message: 'SUBDL_API_KEY is not configured in server secrets.',
    };
  }

  const url = new URL('https://api.subdl.com/api/v1/subtitles');
  url.searchParams.set('api_key', apiKey);
  if (params.tmdbId) url.searchParams.set('tmdb_id', params.tmdbId);
  if (params.query) url.searchParams.set('film_name', params.query);
  if (params.language && params.language !== 'all') {
    url.searchParams.set('languages', normalizeLanguageCode(params.language).toUpperCase());
  }

  try {
    const res = await fetchWithTimeout(
      url.toString(),
      { headers: { Accept: 'application/json' } },
      deps,
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw buildHttpError('SubDL', res, errText, 'Verify SUBDL_API_KEY in server secrets.');
    }

    const data = (await res.json()) as {
      status?: boolean;
      error?: string;
      message?: string;
      results?: Array<{
        tmdb_id?: number;
        name?: string;
        release_date?: string;
        year?: number | string;
        type?: string;
      }>;
      subtitles?: Array<{
        release_name?: string;
        name?: string;
        lang?: string;
        url?: string;
        hi?: boolean;
        season?: number;
        episode?: number;
        episode_from?: number;
        episode_end?: number;
        full_season?: boolean;
      }>;
    };

    if (data.status === false) {
      const rawErr = data.error || data.message || 'SubDL API rejected the request.';
      const safeErr = sanitizeProviderMessage(rawErr);
      const isAuth = /api.?key|invalid|unauthoriz|expired|forbidden/i.test(safeErr);
      const isRate = /rate|limit|quota|too many/i.test(safeErr);
      throw new ProviderRequestError(
        isAuth
          ? `SubDL authentication failed: ${safeErr}`
          : `SubDL error: ${safeErr}`,
        isAuth ? 'auth' : isRate ? 'rate_limit' : 'upstream',
      );
    }

    const catalogEntry = data.results?.[0];
    const catalogYear = catalogEntry?.year
      ? String(catalogEntry.year)
      : catalogEntry?.release_date?.slice(0, 4);

    const results: ProviderSubtitleItem[] = (data.subtitles || [])
      .slice(0, 25)
      .map((s) => {
        const release = (s.release_name || s.name || catalogEntry?.name || 'SubDL release').trim();
        const format = detectFormat([s.name, s.release_name, s.url]);
        const fileName = (
          s.name ||
          (/\.(srt|vtt|ass|ssa|sub)$/i.test(release) ? release : `${release}.${format}`)
        ).trim();
        const epParsed = extractEpisodeMeta(release);
        const season = s.season ?? epParsed.season;
        const episode = s.episode ?? s.episode_from ?? epParsed.episode;
        const epTag = formatEpisodeLabel(season, episode);
        const mediaInfo = epTag
          ? catalogEntry?.name
            ? `${catalogEntry.name} · ${epTag}`
            : epTag
          : catalogEntry?.type || (catalogEntry?.name && catalogEntry.name !== release ? catalogEntry.name : undefined);
        const releaseYear = catalogYear || extractYearFromText(release);
        const downloadable = Boolean(s.url && s.url.trim());
        const rawRef = s.url?.trim() || '';
        const downloadRef = rawRef
          ? rawRef.replace(/([?&])api_key=[^&]*/gi, '$1').replace(/[?&]+$/, '').replace(/\?&/, '?')
          : '';

        return {
          id: buildStableSubtitleId('subdl', [release, fileName, s.lang || '', downloadRef]),
          provider: 'subdl',
          providerLabel: 'SubDL',
          title: catalogEntry?.name || release,
          fileName,
          language: normalizeLanguageCode(s.lang || params.language),
          ...(mediaInfo ? { mediaInfo } : {}),
          ...(typeof season === 'number' ? { season } : {}),
          ...(typeof episode === 'number' ? { episode } : {}),
          release,
          ...(releaseYear ? { releaseYear } : {}),
          format,
          downloadable,
          hearingImpaired: Boolean(s.hi),
          downloadRef,
        };
      });

    recordProviderSuccess('subdl');
    return {
      provider: 'subdl',
      providerLabel: 'SubDL',
      configured: true,
      ok: true,
      results,
    };
  } catch (err: unknown) {
    const safeErr =
      err instanceof ProviderRequestError
        ? err
        : new ProviderRequestError(
            sanitizeProviderMessage(err instanceof Error ? err.message : 'SubDL search failed.'),
            'network',
          );
    recordProviderFailure('subdl', safeErr.message);
    throw safeErr;
  }
}

/**
 * Queries requested subtitle providers concurrently without letting one provider's
 * failure block successful results from another provider, and deduplicates across providers.
 */
export async function searchAllSubtitleProviders(
  params: {
    query?: string;
    tmdbId?: string;
    language?: string;
    provider?: 'all' | SubtitleProviderId;
  },
  deps?: ProviderDeps,
): Promise<MultiProviderSearchResponse> {
  const target = params.provider || 'all';
  const queryOpenSubtitles = target === 'all' || target === 'opensubtitles';
  const querySubdl = target === 'all' || target === 'subdl';

  const toErrorOutcome = (
    provider: SubtitleProviderId,
    providerLabel: string,
    err: unknown,
  ): ProviderSearchOutcome => {
    if (err instanceof ProviderRequestError) {
      return {
        provider,
        providerLabel,
        configured: err.errorCode !== 'unconfigured',
        ok: false,
        results: [],
        error: sanitizeProviderMessage(err.message),
        errorCode: err.errorCode,
      };
    }
    const msg = err instanceof Error ? err.message : `${providerLabel} search failed.`;
    return {
      provider,
      providerLabel,
      configured: true,
      ok: false,
      results: [],
      error: sanitizeProviderMessage(msg),
      errorCode: 'network',
    };
  };

  const [osSettled, subdlSettled] = await Promise.all([
    queryOpenSubtitles
      ? searchOpenSubtitles(params, deps).catch((err) =>
          toErrorOutcome('opensubtitles', 'OpenSubtitles', err),
        )
      : Promise.resolve(undefined),
    querySubdl
      ? searchSubdl(params, deps).catch((err) => toErrorOutcome('subdl', 'SubDL', err))
      : Promise.resolve(undefined),
  ]);

  let duplicatesRemoved = 0;
  if (osSettled && subdlSettled) {
    const combined = [...osSettled.results, ...subdlSettled.results];
    const dedup = deduplicateProviderResults(combined);
    duplicatesRemoved = dedup.duplicatesRemoved;
    osSettled.results = dedup.deduplicated.filter((r) => r.provider === 'opensubtitles');
    subdlSettled.results = dedup.deduplicated.filter((r) => r.provider === 'subdl');
  } else if (osSettled) {
    const dedup = deduplicateProviderResults(osSettled.results);
    duplicatesRemoved = dedup.duplicatesRemoved;
    osSettled.results = dedup.deduplicated;
  } else if (subdlSettled) {
    const dedup = deduplicateProviderResults(subdlSettled.results);
    duplicatesRemoved = dedup.duplicatesRemoved;
    subdlSettled.results = dedup.deduplicated;
  }

  return {
    ...(osSettled ? { opensubtitles: osSettled } : {}),
    ...(subdlSettled ? { subdl: subdlSettled } : {}),
    duplicatesRemoved,
  };
}

/**
 * Minimal pure-Node ZIP extractor for single subtitle archive downloads (e.g. Subdl).
 */
function extractSubtitleFromZip(zipBuffer: Buffer): { buffer: Buffer; fileName: string } | null {
  // Local file header signature: 0x04034b50
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compression = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraLength = zipBuffer.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const fileName = zipBuffer.subarray(nameStart, nameEnd).toString('utf8');
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (compressedSize > 0 && dataEnd <= zipBuffer.length) {
      const isSubtitle = /\.(srt|vtt|ass|ssa)$/i.test(fileName);
      if (isSubtitle) {
        const compressedData = zipBuffer.subarray(dataStart, dataEnd);
        if (compression === 0) {
          return { buffer: compressedData, fileName };
        }
        if (compression === 8) {
          return { buffer: zlib.inflateRawSync(compressedData), fileName };
        }
      }
    }

    if (compressedSize === 0) break;
    offset = dataEnd;
  }
  return null;
}

export async function downloadSubdlFile(
  downloadPath: string,
  deps?: ProviderDeps,
): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  if (!downloadPath?.trim()) {
    throw new ProviderRequestError('SubDL download path is missing.', 'upstream', 400);
  }
  const baseUrl = downloadPath.startsWith('http')
    ? downloadPath
    : `https://dl.subdl.com${downloadPath.startsWith('/') ? '' : '/'}${downloadPath}`;
  const urlObj = new URL(baseUrl);
  const subdlKey = process.env.SUBDL_API_KEY?.trim();
  if (subdlKey && urlObj.hostname.endsWith('subdl.com') && !urlObj.searchParams.has('api_key')) {
    urlObj.searchParams.set('api_key', subdlKey);
  }
  const fullUrl = urlObj.toString();

  const res = await fetchWithTimeout(fullUrl, undefined, deps);
  if (!res.ok) {
    throw new ProviderRequestError(
      `SubDL download failed (HTTP ${res.status}).`,
      res.status === 429 ? 'rate_limit' : 'upstream',
      res.status,
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  // Check if ZIP archive (PK\x03\x04)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const extracted = extractSubtitleFromZip(buffer);
    if (!extracted) {
      throw new ProviderRequestError(
        'Downloaded SubDL archive did not contain a readable SRT/VTT/ASS file.',
        'upstream',
      );
    }
    return extracted;
  }

  return {
    buffer,
    fileName: downloadPath.split('/').pop() || 'subdl_subtitle.srt',
  };
}

export async function verifyProviderConnection(
  provider: IntegrationProviderId,
  deps?: ProviderDeps,
): Promise<ProviderDiagnostic> {
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      runtimeDiagnostics.gemini = {
        verificationStatus: null,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: runtimeDiagnostics.gemini.lastSuccessAt,
        error: 'GEMINI_API_KEY is not configured in server secrets.',
      };
      return getIntegrationsDiagnostics().find((d) => d.provider === 'gemini')!;
    }
    try {
      if (deps?.geminiCheckFn) {
        await deps.geminiCheckFn(apiKey);
      } else {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });
        await ai.models.get({ model: DEFAULT_GEMINI_MODEL });
      }
      recordProviderSuccess('gemini');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini verification failed.';
      recordProviderFailure('gemini', sanitizeProviderMessage(msg));
    }
    return getIntegrationsDiagnostics().find((d) => d.provider === 'gemini')!;
  }

  if (provider === 'tmdb') {
    const auth = resolveTmdbAuth();
    if (!auth.configured) {
      runtimeDiagnostics.tmdb = {
        verificationStatus: null,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: runtimeDiagnostics.tmdb.lastSuccessAt,
        error: 'TMDB_READ_ACCESS_TOKEN / TMDB_API_KEY is not configured in server secrets.',
      };
      return getIntegrationsDiagnostics().find((d) => d.provider === 'tmdb')!;
    }
    try {
      const url = new URL('https://api.themoviedb.org/3/configuration');
      if (auth.mode === 'v3_api_key') {
        url.searchParams.set('api_key', auth.secret);
      }
      const res = await fetchWithTimeout(
        url.toString(),
        {
          headers:
            auth.mode === 'bearer_token'
              ? { Authorization: `Bearer ${auth.secret}`, Accept: 'application/json' }
              : { Accept: 'application/json' },
        },
        deps,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw buildHttpError(
          'TMDB',
          res,
          body,
          'Verify TMDB_READ_ACCESS_TOKEN (Bearer) or TMDB_API_KEY (v3).',
        );
      }
      recordProviderSuccess('tmdb');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'TMDB verification failed.';
      recordProviderFailure('tmdb', sanitizeProviderMessage(msg));
    }
    return getIntegrationsDiagnostics().find((d) => d.provider === 'tmdb')!;
  }

  if (provider === 'opensubtitles') {
    if (!process.env.OPENSUBTITLES_API_KEY?.trim()) {
      runtimeDiagnostics.opensubtitles = {
        verificationStatus: null,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: runtimeDiagnostics.opensubtitles.lastSuccessAt,
        error: 'OPENSUBTITLES_API_KEY is not configured in server secrets.',
      };
      return getIntegrationsDiagnostics().find((d) => d.provider === 'opensubtitles')!;
    }
    try {
      await searchOpenSubtitles({ query: 'matrix', language: 'en' }, deps);
    } catch {
      // Failure state already recorded by searchOpenSubtitles
    }
    return getIntegrationsDiagnostics().find((d) => d.provider === 'opensubtitles')!;
  }

  // subdl
  if (!process.env.SUBDL_API_KEY?.trim()) {
    runtimeDiagnostics.subdl = {
      verificationStatus: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: runtimeDiagnostics.subdl.lastSuccessAt,
      error: 'SUBDL_API_KEY is not configured in server secrets.',
    };
    return getIntegrationsDiagnostics().find((d) => d.provider === 'subdl')!;
  }
  try {
    await searchSubdl({ query: 'matrix', language: 'en' }, deps);
  } catch {
    // Failure state already recorded by searchSubdl
  }
  return getIntegrationsDiagnostics().find((d) => d.provider === 'subdl')!;
}
