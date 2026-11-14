import zlib from 'node:zlib';
import type {
  IntegrationsStatus,
  ProviderSubtitleItem,
  TmdbSearchItem,
} from '../../src/types/subtitle.ts';

export function getIntegrationsStatus(): IntegrationsStatus {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    tmdb: Boolean(process.env.TMDB_API_KEY),
    opensubtitles: Boolean(process.env.OPENSUBTITLES_API_KEY),
    subdl: Boolean(process.env.SUBDL_API_KEY),
  };
}

export async function searchTmdb(query: string): Promise<{
  configured: boolean;
  results: TmdbSearchItem[];
  message?: string;
}> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      results: [],
      message:
        'TMDB_API_KEY is not configured in Settings > Secrets. Add a TMDB API key to enable live movie and TV catalog search, or upload subtitle files directly.',
    };
  }

  const isBearer = apiKey.length > 45;
  const url = new URL('https://api.themoviedb.org/3/search/multi');
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('language', 'en-US');
  if (!isBearer) {
    url.searchParams.set('api_key', apiKey);
  }

  const res = await fetch(url.toString(), {
    headers: isBearer ? { Authorization: `Bearer ${apiKey}` } : {},
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`TMDB API error (${res.status}): ${errText || res.statusText}`);
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

  return { configured: true, results: items };
}

export async function searchOpenSubtitles(params: {
  query?: string;
  tmdbId?: string;
  language?: string;
}): Promise<{ configured: boolean; results: ProviderSubtitleItem[]; message?: string }> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      results: [],
      message: 'OPENSUBTITLES_API_KEY is not configured in Settings > Secrets.',
    };
  }

  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  if (params.tmdbId) url.searchParams.set('tmdb_id', params.tmdbId);
  if (params.query) url.searchParams.set('query', params.query);
  if (params.language) url.searchParams.set('languages', params.language);

  const res = await fetch(url.toString(), {
    headers: {
      'Api-Key': apiKey,
      'User-Agent': process.env.OPENSUBTITLES_USER_AGENT || 'TriLineStudio v1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenSubtitles API error (${res.status}): ${errText || res.statusText}`);
  }

  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      attributes?: {
        language?: string;
        release?: string;
        download_count?: number;
        hearing_impaired?: boolean;
        files?: Array<{ file_id: number; file_name: string }>;
      };
    }>;
  };

  const results: ProviderSubtitleItem[] = [];
  for (const item of data.data || []) {
    const file = item.attributes?.files?.[0];
    if (!file) continue;
    results.push({
      id: `os-${item.id}`,
      provider: 'opensubtitles',
      fileName: file.file_name || `${item.attributes?.release || 'subtitle'}.srt`,
      language: item.attributes?.language || params.language || 'unknown',
      release: item.attributes?.release || file.file_name || 'OpenSubtitles release',
      downloadCount: item.attributes?.download_count,
      hearingImpaired: item.attributes?.hearing_impaired,
      format: file.file_name?.split('.').pop()?.toLowerCase() || 'srt',
      downloadRef: String(file.file_id),
    });
  }

  return { configured: true, results: results.slice(0, 20) };
}

export async function downloadOpenSubtitleFile(fileId: string): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey) {
    throw new Error('OPENSUBTITLES_API_KEY is not configured.');
  }

  const res = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'User-Agent': process.env.OPENSUBTITLES_USER_AGENT || 'TriLineStudio v1.0',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ file_id: Number(fileId) }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenSubtitles download failed (${res.status}): ${errText || res.statusText}`);
  }

  const data = (await res.json()) as { link?: string; file_name?: string };
  if (!data.link) {
    throw new Error('OpenSubtitles did not return a download URL.');
  }

  const fileRes = await fetch(data.link);
  if (!fileRes.ok) {
    throw new Error(`Failed to fetch subtitle payload (${fileRes.status})`);
  }

  const arrBuf = await fileRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrBuf),
    fileName: data.file_name || `opensubtitles_${fileId}.srt`,
  };
}

export async function searchSubdl(params: {
  query?: string;
  tmdbId?: string;
  language?: string;
}): Promise<{ configured: boolean; results: ProviderSubtitleItem[]; message?: string }> {
  const apiKey = process.env.SUBDL_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      results: [],
      message: 'SUBDL_API_KEY is not configured in Settings > Secrets.',
    };
  }

  const url = new URL('https://api.subdl.com/api/v1/subtitles');
  url.searchParams.set('api_key', apiKey);
  if (params.tmdbId) url.searchParams.set('tmdb_id', params.tmdbId);
  if (params.query) url.searchParams.set('film_name', params.query);
  if (params.language) url.searchParams.set('languages', params.language.toUpperCase());

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Subdl API error (${res.status}): ${errText || res.statusText}`);
  }

  const data = (await res.json()) as {
    status?: boolean;
    subtitles?: Array<{
      release_name?: string;
      name?: string;
      lang?: string;
      url?: string;
      hi?: boolean;
    }>;
  };

  const results: ProviderSubtitleItem[] = (data.subtitles || [])
    .filter((s) => Boolean(s.url))
    .slice(0, 20)
    .map((s, idx) => ({
      id: `subdl-${idx}-${Date.now()}`,
      provider: 'subdl',
      fileName: s.name || `${s.release_name || 'subtitle'}.srt`,
      language: s.lang || params.language || 'unknown',
      release: s.release_name || s.name || 'Subdl release',
      hearingImpaired: s.hi,
      downloadRef: s.url || '',
    }));

  return { configured: true, results };
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

export async function downloadSubdlFile(downloadPath: string): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const fullUrl = downloadPath.startsWith('http')
    ? downloadPath
    : `https://dl.subdl.com${downloadPath.startsWith('/') ? '' : '/'}${downloadPath}`;

  const res = await fetch(fullUrl);
  if (!res.ok) {
    throw new Error(`Subdl download failed (${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  // Check if ZIP archive (PK\x03\x04)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const extracted = extractSubtitleFromZip(buffer);
    if (!extracted) {
      throw new Error('Downloaded Subdl archive did not contain a readable SRT/VTT/ASS file.');
    }
    return extracted;
  }

  return {
    buffer,
    fileName: downloadPath.split('/').pop() || 'subdl_subtitle.srt',
  };
}
