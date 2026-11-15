import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deduplicateProviderResults,
  downloadOpenSubtitleFile,
  downloadSubdlFile,
  getIntegrationsDiagnostics,
  getIntegrationsStatus,
  ProviderRequestError,
  resetDiagnosticsForTests,
  resolveTmdbAuth,
  sanitizeProviderMessage,
  searchAllSubtitleProviders,
  searchOpenSubtitles,
  searchSubdl,
  searchTmdb,
  verifyProviderConnection,
} from '../server/providers/integrations.ts';
import type { ProviderSubtitleItem } from '../src/types/subtitle.ts';

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'TMDB_READ_ACCESS_TOKEN',
  'TMDB_V3_API_KEY',
  'TMDB_API_KEY',
  'OPENSUBTITLES_API_KEY',
  'OPENSUBTITLES_USER_AGENT',
  'SUBDL_API_KEY',
] as const;

let savedEnv: Record<string, string | undefined> = {};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function buildMinimalZip(fileName: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(fileName, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // compression = 0 (STORE)
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14); // crc32 ignored by extractor
  header.writeUInt32LE(content.length, 18); // compressed size
  header.writeUInt32LE(content.length, 22); // uncompressed size
  header.writeUInt16LE(nameBuf.length, 26); // file name length
  header.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([header, nameBuf, content]);
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetDiagnosticsForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  resetDiagnosticsForTests();
});

describe('API Integrations Hardening & Provider Normalization', () => {
  it('handles missing environment variables safely across status, diagnostics, and searches', async () => {
    const status = getIntegrationsStatus();
    assert.deepEqual(status, {
      gemini: false,
      tmdb: false,
      opensubtitles: false,
      subdl: false,
      tmdbAuthMode: 'none',
    });

    const diagnostics = getIntegrationsDiagnostics();
    assert.equal(diagnostics.length, 4);
    for (const d of diagnostics) {
      assert.equal(d.configured, false);
      assert.equal(d.verificationStatus, 'unconfigured');
      assert.equal(d.lastSuccessAt, null);
    }

    const tmdb = await searchTmdb('Dark');
    assert.equal(tmdb.configured, false);
    assert.deepEqual(tmdb.results, []);

    const os = await searchOpenSubtitles({ query: 'Dark' });
    assert.equal(os.configured, false);
    assert.equal(os.ok, false);
    assert.equal(os.errorCode, 'unconfigured');

    const subdl = await searchSubdl({ query: 'Dark' });
    assert.equal(subdl.configured, false);
    assert.equal(subdl.ok, false);
    assert.equal(subdl.errorCode, 'unconfigured');
  });

  it('supports explicit TMDB Bearer Read Access Token, v3 API key, and legacy JWT without length heuristics', async () => {
    // 1. Explicit TMDB_READ_ACCESS_TOKEN -> Bearer header, no api_key param
    process.env.TMDB_READ_ACCESS_TOKEN = 'tmdb-read-token-secret-xyz';
    process.env.TMDB_API_KEY = 'legacy-v3-key-123456';

    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;
    const res1 = await searchTmdb('Parasite', {
      fetchFn: async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = init?.headers;
        return jsonResponse({
          results: [
            {
              id: 496243,
              media_type: 'movie',
              title: 'Parasite',
              release_date: '2019-05-30',
              poster_path: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
              original_language: 'ko',
              vote_average: 8.5,
            },
          ],
        });
      },
    });
    assert.equal(res1.configured, true);
    assert.equal(res1.results.length, 1);
    assert.equal((capturedHeaders as Record<string, string>).Authorization, 'Bearer tmdb-read-token-secret-xyz');
    assert.equal(new URL(capturedUrl).searchParams.get('api_key'), null);
    assert.equal(resolveTmdbAuth().mode, 'bearer_token');

    // 2. Long v3 API key in TMDB_API_KEY (>45 chars, NOT a JWT) must still use v3 api_key, NOT Bearer!
    delete process.env.TMDB_READ_ACCESS_TOKEN;
    process.env.TMDB_API_KEY = 'v3_key_longer_than_45_characters_0123456789abcdef';
    assert.equal(resolveTmdbAuth().mode, 'v3_api_key');

    await searchTmdb('Dark', {
      fetchFn: async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = init?.headers;
        return jsonResponse({ results: [] });
      },
    });
    assert.equal(
      new URL(capturedUrl).searchParams.get('api_key'),
      'v3_key_longer_than_45_characters_0123456789abcdef',
    );
    assert.equal((capturedHeaders as Record<string, string>)?.Authorization, undefined);

    // 3. Invalid TMDB credentials (HTTP 401) must fail cleanly and redact secret
    process.env.TMDB_READ_ACCESS_TOKEN = 'secret-invalid-bearer-token';
    await assert.rejects(
      () =>
        searchTmdb('Dark', {
          fetchFn: async () =>
            new Response('Invalid Bearer secret-invalid-bearer-token', { status: 401 }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderRequestError);
        assert.equal(err.errorCode, 'auth');
        assert.ok(!err.message.includes('secret-invalid-bearer-token'));
        return true;
      },
    );
  });

  it('handles OpenSubtitles authentication, API errors, and file download', async () => {
    process.env.OPENSUBTITLES_API_KEY = 'os-secret-key-999';
    process.env.OPENSUBTITLES_USER_AGENT = 'LangSubTest v2.0';

    let sawHeaders: Record<string, string> = {};
    const searchRes = await searchOpenSubtitles(
      { query: 'Dark', language: 'German' },
      {
        fetchFn: async (_url, init) => {
          sawHeaders = init?.headers as Record<string, string>;
          return jsonResponse({
            data: [
              {
                id: '101',
                attributes: {
                  language: 'de',
                  release: 'Dark.S01E01.1080p.NF.WEB-DL.DDP5.1.x264-NTb',
                  download_count: 1450,
                  hearing_impaired: true,
                  feature_details: {
                    title: 'Secrets',
                    parent_title: 'Dark',
                    year: 2017,
                    season_number: 1,
                    episode_number: 1,
                  },
                  files: [{ file_id: 555, file_name: 'Dark.S01E01.de.srt' }],
                },
              },
              {
                id: '102',
                attributes: {
                  language: 'de',
                  release: 'Dark.S01E02.1080p.WEB.ass',
                  files: [],
                },
              },
            ],
          });
        },
      },
    );

    assert.equal(sawHeaders['Api-Key'], 'os-secret-key-999');
    assert.equal(sawHeaders['User-Agent'], 'LangSubTest v2.0');
    assert.equal(searchRes.ok, true);
    assert.equal(searchRes.results.length, 2);
    assert.deepEqual(searchRes.results[0], {
      id: 'os-101',
      provider: 'opensubtitles',
      providerLabel: 'OpenSubtitles',
      title: 'Secrets',
      fileName: 'Dark.S01E01.de.srt',
      language: 'de',
      mediaInfo: 'Dark · S01E01',
      season: 1,
      episode: 1,
      release: 'Dark.S01E01.1080p.NF.WEB-DL.DDP5.1.x264-NTb',
      releaseYear: '2017',
      format: 'srt',
      downloadable: true,
      downloadCount: 1450,
      hearingImpaired: true,
      downloadRef: '555',
    });
    assert.equal(searchRes.results[1].downloadable, false);
    assert.equal(searchRes.results[1].format, 'ass');

    // Download workflow
    const srtPayload = '1\n00:00:01,000 --> 00:00:03,000\nAlles ist miteinander verbunden.\n';
    const downloaded = await downloadOpenSubtitleFile('555', {
      fetchFn: async (input) => {
        const u = String(input);
        if (u.includes('/api/v1/download')) {
          return jsonResponse({
            link: 'https://cdn.example.test/sub555.srt',
            file_name: 'Dark.S01E01.de.srt',
          });
        }
        return new Response(srtPayload, { status: 200 });
      },
    });
    assert.equal(downloaded.fileName, 'Dark.S01E01.de.srt');
    assert.equal(downloaded.buffer.toString('utf8'), srtPayload);

    // 403 Invalid Key
    await assert.rejects(
      () =>
        searchOpenSubtitles(
          { query: 'Dark' },
          { fetchFn: async () => new Response('Forbidden', { status: 403 }) },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProviderRequestError);
        assert.equal(err.errorCode, 'auth');
        return true;
      },
    );
  });

  it('handles SubDL authentication, HTTP 200 error payloads, secret redaction, and ZIP extraction', async () => {
    process.env.SUBDL_API_KEY = 'subdl-secret-key-abc123';

    // HTTP 200 with { status: false, error: 'Invalid api_key subdl-secret-key-abc123' }
    await assert.rejects(
      () =>
        searchSubdl(
          { query: 'Amelie' },
          {
            fetchFn: async () =>
              jsonResponse({
                status: false,
                error: 'Invalid api_key subdl-secret-key-abc123',
              }),
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProviderRequestError);
        assert.equal(err.errorCode, 'auth');
        assert.ok(!err.message.includes('subdl-secret-key-abc123'));
        assert.ok(err.message.includes('[REDACTED]'));
        return true;
      },
    );

    // Normalized SubDL response
    const okRes = await searchSubdl(
      { query: 'Amelie', language: 'French' },
      {
        fetchFn: async () =>
          jsonResponse({
            status: true,
            results: [{ tmdb_id: 194, name: 'Amélie', year: 2001, type: 'movie' }],
            subtitles: [
              {
                release_name: 'Amelie.2001.1080p.BluRay.x264',
                name: 'Amelie.2001.FR.ass',
                lang: 'FR',
                url: '/subtitle/194-1.zip?api_key=subdl-secret-key-abc123',
                hi: false,
              },
            ],
          }),
      },
    );
    assert.equal(okRes.ok, true);
    assert.equal(okRes.results.length, 1);
    assert.equal(okRes.results[0].providerLabel, 'SubDL');
    assert.equal(okRes.results[0].title, 'Amélie');
    assert.equal(okRes.results[0].language, 'fr');
    assert.equal(okRes.results[0].format, 'ass');
    assert.equal(okRes.results[0].releaseYear, '2001');
    assert.equal(okRes.results[0].downloadable, true);
    assert.equal(okRes.results[0].downloadRef, '/subtitle/194-1.zip');

    // ZIP extraction
    const assText = '[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Bonjour.\n';
    const zipBuf = buildMinimalZip('Amelie.2001.FR.ass', Buffer.from(assText, 'utf8'));
    const extracted = await downloadSubdlFile('/subtitle/194-1.zip', {
      fetchFn: async () => new Response(new Uint8Array(zipBuf), { status: 200 }),
    });
    assert.equal(extracted.fileName, 'Amelie.2001.FR.ass');
    assert.equal(extracted.buffer.toString('utf8'), assText);
  });

  it('handles provider timeouts and rate limits cleanly', async () => {
    process.env.TMDB_READ_ACCESS_TOKEN = 'valid-token';
    process.env.OPENSUBTITLES_API_KEY = 'valid-os-key';

    // Real AbortController timeout with never-resolving fetch
    await assert.rejects(
      () =>
        searchTmdb('Inception', {
          timeoutMs: 25,
          fetchFn: (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                const abortErr = new Error('The operation was aborted');
                abortErr.name = 'AbortError';
                reject(abortErr);
              });
            }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderRequestError);
        assert.equal(err.errorCode, 'timeout');
        return true;
      },
    );

    // Rate limit 429 with Retry-After
    await assert.rejects(
      () =>
        searchOpenSubtitles(
          { query: 'Inception' },
          {
            fetchFn: async () =>
              new Response('Too Many Requests', {
                status: 429,
                headers: { 'Retry-After': '45' },
              }),
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProviderRequestError);
        assert.equal(err.errorCode, 'rate_limit');
        assert.ok(err.message.includes('45s'));
        return true;
      },
    );
  });

  it('deduplicates matching subtitle releases across providers while preserving distinct HI/formats', () => {
    const items: ProviderSubtitleItem[] = [
      {
        id: 'os-1',
        provider: 'opensubtitles',
        providerLabel: 'OpenSubtitles',
        title: 'Dark',
        fileName: 'Dark.S01E01.1080p.WEB-DL-NTb.srt',
        language: 'de',
        mediaInfo: 'Dark · S01E01',
        release: 'Dark.S01E01.1080p.WEB-DL-NTb',
        releaseYear: '2017',
        format: 'srt',
        downloadable: true,
        downloadCount: 900,
        hearingImpaired: false,
        downloadRef: '11',
      },
      {
        id: 'subdl-1',
        provider: 'subdl',
        providerLabel: 'SubDL',
        title: 'Dark',
        fileName: 'Dark S01E01 1080p WEB-DL NTb.srt',
        language: 'de',
        release: 'Dark S01E01 1080p WEB-DL NTb',
        format: 'srt',
        downloadable: true,
        hearingImpaired: false,
        downloadRef: '/subtitle/1.zip',
      },
      {
        id: 'subdl-hi',
        provider: 'subdl',
        providerLabel: 'SubDL',
        title: 'Dark',
        fileName: 'Dark.S01E01.1080p.WEB-DL-NTb.HI.srt',
        language: 'de',
        release: 'Dark.S01E01.1080p.WEB-DL-NTb',
        format: 'srt',
        downloadable: true,
        hearingImpaired: true, // Distinct HI track -> must NOT be removed!
        downloadRef: '/subtitle/2.zip',
      },
      {
        id: 'subdl-ass',
        provider: 'subdl',
        providerLabel: 'SubDL',
        title: 'Dark',
        fileName: 'Dark.S01E01.1080p.WEB-DL-NTb.ass',
        language: 'de',
        release: 'Dark.S01E01.1080p.WEB-DL-NTb',
        format: 'ass', // Distinct format -> must NOT be removed!
        downloadable: true,
        hearingImpaired: false,
        downloadRef: '/subtitle/3.zip',
      },
    ];

    const { deduplicated, duplicatesRemoved } = deduplicateProviderResults(items);
    assert.equal(duplicatesRemoved, 1);
    assert.equal(deduplicated.length, 3);
    assert.deepEqual(deduplicated[0].alsoOnProviders, ['opensubtitles', 'subdl']);
  });

  it('isolates partial provider failures so working providers still return results', async () => {
    process.env.OPENSUBTITLES_API_KEY = 'os-valid';
    process.env.SUBDL_API_KEY = 'subdl-rate-limited';

    const combined = await searchAllSubtitleProviders(
      { query: 'Your Name', language: 'Japanese', provider: 'all' },
      {
        fetchFn: async (input) => {
          const url = String(input);
          if (url.includes('api.opensubtitles.com')) {
            return jsonResponse({
              data: [
                {
                  id: '999',
                  attributes: {
                    language: 'ja',
                    release: 'Kimi.no.Na.wa.2016.BluRay',
                    feature_details: { title: 'Your Name', year: 2016 },
                    files: [{ file_id: 777, file_name: 'Kimi.no.Na.wa.ja.srt' }],
                  },
                },
              ],
            });
          }
          // SubDL fails with HTTP 503
          return new Response('Service Unavailable', { status: 503 });
        },
      },
    );

    assert.equal(combined.opensubtitles?.ok, true);
    assert.equal(combined.opensubtitles?.results.length, 1);
    assert.equal(combined.opensubtitles?.results[0].language, 'ja');

    assert.equal(combined.subdl?.ok, false);
    assert.equal(combined.subdl?.configured, true);
    assert.equal(combined.subdl?.errorCode, 'upstream');
    assert.ok(combined.subdl?.error?.includes('503'));
    assert.deepEqual(combined.subdl?.results, []);
  });

  it('tracks integration diagnostics verification status and redacts secrets', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-secret-key';
    process.env.TMDB_READ_ACCESS_TOKEN = 'tmdb-test-bearer-secret';

    const geminiDiag = await verifyProviderConnection('gemini', {
      geminiCheckFn: async () => {
        // simulated valid model lookup
      },
    });
    assert.equal(geminiDiag.configured, true);
    assert.equal(geminiDiag.verificationStatus, 'verified');
    assert.ok(geminiDiag.lastSuccessAt);
    assert.equal(geminiDiag.error, null);

    const tmdbFail = await verifyProviderConnection('tmdb', {
      fetchFn: async () =>
        new Response('Unauthorized token tmdb-test-bearer-secret', { status: 401 }),
    });
    assert.equal(tmdbFail.verificationStatus, 'failed');
    assert.equal(tmdbFail.lastSuccessAt, null);
    assert.ok(tmdbFail.error);
    assert.ok(!tmdbFail.error.includes('tmdb-test-bearer-secret'));

    const scrubbed = sanitizeProviderMessage(
      'GET https://api.subdl.com/api/v1/subtitles?api_key=MYSECRET123&film_name=dark failed',
    );
    assert.ok(!scrubbed.includes('MYSECRET123'));
    assert.ok(scrubbed.includes('api_key=[REDACTED]'));
  });
});
