import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getProjectById,
  listProjects,
  resetStoreForTests,
  saveProject,
  updateProject,
} from '../server/db/store.ts';
import {
  sanitizeExportFileName,
  sanitizeStyleConfig,
  validateExportCues,
  validateStyleConfigInput,
} from '../server/validation/projectValidation.ts';
import {
  formatAssTime,
  formatSrtTime,
  formatVttTime,
  generateAssContent,
  generateSrtContent,
  generateVttContent,
} from '../server/subtitles/exporter.ts';
import {
  downloadOpenSubtitleFile,
  downloadSubdlFile,
  getIntegrationsDiagnostics,
  ProviderRequestError,
  resetDiagnosticsForTests,
} from '../server/providers/integrations.ts';
import { processTriLineConversion, type BatchInputCue } from '../server/ai/translator.ts';
import {
  computeEffectiveCueDurationMs,
  getActiveWordIndex,
  rescaleElapsedForSpeedChange,
  resolveCueTickCompletion,
  resolveLineActiveWordIndex,
  tokenizeCueWords,
} from '../src/utils/learningControls.ts';
import { CinemaPreview } from '../src/components/CinemaPreview.tsx';
import {
  DEFAULT_STYLE_CONFIG,
  type AssStyleConfig,
  type SavedProject,
  type TriLineCue,
} from '../src/types/subtitle.ts';

interface ZipEntrySpec {
  name: string;
  content: Buffer;
  compression?: number; // 0 = store, 8 = deflate, or custom unsupported method
  useDataDescriptor?: boolean;
  rawCompressedOverride?: Buffer;
  uncompressedSizeOverride?: number;
}

function buildCustomZip(entries: ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compression = entry.compression ?? 8;
    const isDir = entry.name.endsWith('/');
    const crc = isDir ? 0 : zlib.crc32(entry.content) >>> 0;
    const compressed =
      entry.rawCompressedOverride ??
      (isDir
        ? Buffer.alloc(0)
        : compression === 0
          ? entry.content
          : compression === 8
            ? zlib.deflateRawSync(entry.content)
            : entry.content);
    const uncompressedSize = entry.uncompressedSizeOverride ?? entry.content.length;
    const flags = entry.useDataDescriptor ? 0x0008 : 0;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(compression, 8);
    localHeader.writeUInt32LE(entry.useDataDescriptor ? 0 : crc, 14);
    localHeader.writeUInt32LE(entry.useDataDescriptor ? 0 : compressed.length, 18);
    localHeader.writeUInt32LE(entry.useDataDescriptor ? 0 : uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(localHeader, 30);

    const dataDesc = entry.useDataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (entry.useDataDescriptor) {
      dataDesc.writeUInt32LE(0x08074b50, 0);
      dataDesc.writeUInt32LE(crc, 4);
      dataDesc.writeUInt32LE(compressed.length, 8);
      dataDesc.writeUInt32LE(uncompressedSize, 12);
    }

    const cdHeader = Buffer.alloc(46 + nameBuf.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(flags, 8);
    cdHeader.writeUInt16LE(compression, 10);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(compressed.length, 20);
    cdHeader.writeUInt32LE(uncompressedSize, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(cdHeader, 46);

    localParts.push(localHeader, compressed, dataDesc);
    cdParts.push(cdHeader);
    offset += localHeader.length + compressed.length + dataDesc.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

function makeValidProject(overrides: Partial<SavedProject> = {}): SavedProject {
  const now = new Date().toISOString();
  return {
    id: 'proj-valid-1',
    cacheKey: 'ck-valid-1',
    title: 'Valid Movie',
    baseLang: 'English',
    targetLang: 'German',
    mode: 'target-first',
    phoneticStyle: 'hyphenated',
    translationStyle: 'natural',
    sourceFileName: 'movie.srt',
    sourceFormat: 'srt',
    createdAt: now,
    updatedAt: now,
    cues: [
      {
        id: 'cue-1',
        index: 1,
        startMs: 1000,
        endMs: 3200,
        baseText: 'Good evening.',
        targetText: 'Guten Abend.',
        phoneticText: 'GOO-ten AH-bent.',
      },
    ],
    processingReport: {
      detectedEncoding: 'UTF-8',
      originalFormat: 'srt',
      totalInputCues: 1,
      sdhStrippedCount: 0,
      duplicatesRemovedCount: 0,
      mergedLineCount: 0,
      finalCueCount: 1,
      sdhRemovedSamples: [],
    },
    styleConfig: { ...DEFAULT_STYLE_CONFIG },
    ...overrides,
  };
}

let tmpDir: string;
const origEnv = { ...process.env };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langsub-phase3b-'));
  process.env.TRILINE_DB_PATH = path.join(tmpDir, 'db.json');
  resetDiagnosticsForTests();
  await resetStoreForTests();
});

afterEach(async () => {
  process.env = { ...origEnv };
  resetDiagnosticsForTests();
  await resetStoreForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Phase 3B (1): Project Data Validation & Safe Recovery', () => {
  it('rejects malformed projects on saveProject and updateProject without corrupting valid projects', async () => {
    const valid = await saveProject(makeValidProject());
    assert.equal(valid.id, 'proj-valid-1');

    // Empty / whitespace title
    await assert.rejects(
      () => saveProject(makeValidProject({ id: 'bad-title', title: '   ' })),
      /title/i,
    );
    // Missing language metadata
    await assert.rejects(
      () => saveProject(makeValidProject({ id: 'bad-lang', baseLang: '  ' })),
      /baseLang/i,
    );
    await assert.rejects(
      () => saveProject(makeValidProject({ id: 'bad-lang-2', targetLang: '' })),
      /targetLang/i,
    );
    // Negative timestamp
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-neg-ts',
            cues: [{ ...valid.cues[0], startMs: -100, endMs: 500 }],
          }),
        ),
      /startMs/i,
    );
    // NaN timestamp
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-nan-ts',
            cues: [{ ...valid.cues[0], startMs: Number.NaN, endMs: 500 }],
          }),
        ),
      /startMs/i,
    );
    // End earlier than start
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-end-ts',
            cues: [{ ...valid.cues[0], startMs: 3000, endMs: 1000 }],
          }),
        ),
      /endMs/i,
    );
    // Missing cue ID or invalid index
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-cue-id',
            cues: [{ ...valid.cues[0], id: '' }],
          }),
        ),
      /id/i,
    );
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-cue-idx',
            cues: [{ ...valid.cues[0], index: 0 }],
          }),
        ),
      /index/i,
    );
    // Missing text field / wrong type / all-blank text
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-cue-text',
            cues: [{ ...valid.cues[0], targetText: undefined as unknown as string }],
          }),
        ),
      /baseText, targetText, and phoneticText/i,
    );
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-empty-text',
            cues: [{ ...valid.cues[0], baseText: ' ', targetText: '', phoneticText: '  ' }],
          }),
        ),
      /no subtitle text/i,
    );
    // Malformed styleConfig on save & update
    await assert.rejects(
      () =>
        saveProject(
          makeValidProject({
            id: 'bad-style',
            styleConfig: { lineOrder: 'broken' } as unknown as AssStyleConfig,
          }),
        ),
      /lineOrder/i,
    );
    await assert.rejects(
      () =>
        updateProject('proj-valid-1', {
          styleConfig: { baseColor: 'not-a-hex' } as unknown as AssStyleConfig,
        }),
      /baseColor/i,
    );
    await assert.rejects(
      () => updateProject('proj-valid-1', { title: '   ' }),
      /title/i,
    );

    // Original valid project remains completely intact
    const intact = await getProjectById('proj-valid-1');
    assert.ok(intact);
    assert.equal(intact.title, 'Valid Movie');
    assert.equal(intact.cues.length, 1);
  });

  it('recovers valid persisted projects with malformed styleConfig/omitted cue identity while rejecting unrecoverable records', async () => {
    const dbPayload = {
      version: 2,
      projects: [
        // Recoverable project: malformed styleConfig, bad updatedAt, omitted cue id/index
        {
          id: 'proj-recoverable',
          title: '  Recoverable Film  ',
          baseLang: 'English',
          targetLang: 'French',
          updatedAt: 'not-a-real-date',
          styleConfig: {
            lineOrder: ['invalid', 'target', 'target', 42],
            baseColor: 'rgb(0,0,0)',
            fontFamily: 'Arial, Bold\nInjected',
            alignment: 99,
            baseFontSize: Number.NaN,
          },
          cues: [
            {
              startMs: 0,
              endMs: 1500,
              baseText: 'Hello',
              targetText: 'Bonjour',
              phoneticText: 'boh(n)-ZHOOR',
            },
          ],
        },
        // Unrecoverable: whitespace-only title
        { id: 'bad-1', title: '   ', baseLang: 'English', targetLang: 'German', cues: [] },
        // Unrecoverable: missing language metadata
        { id: 'bad-2', title: 'No Lang', baseLang: 'English', cues: [] },
        // Unrecoverable: negative timestamp
        {
          id: 'bad-3',
          title: 'Neg Time',
          baseLang: 'English',
          targetLang: 'German',
          cues: [{ id: 'c1', index: 1, startMs: -1, endMs: 100, baseText: 'a', targetText: 'b', phoneticText: 'c' }],
        },
        // Unrecoverable: wrong cue index type
        {
          id: 'bad-4',
          title: 'Wrong Idx Type',
          baseLang: 'English',
          targetLang: 'German',
          cues: [{ id: 'c1', index: 'one', startMs: 0, endMs: 100, baseText: 'a', targetText: 'b', phoneticText: 'c' }],
        },
        // Unrecoverable: missing phoneticText field
        {
          id: 'bad-5',
          title: 'Missing Field',
          baseLang: 'English',
          targetLang: 'German',
          cues: [{ id: 'c1', index: 1, startMs: 0, endMs: 100, baseText: 'a', targetText: 'b' }],
        },
      ],
      // Non-plain-object lineCache/jobs arrays must be safely reset to {}
      lineCache: ['not', 'a', 'map'],
      jobs: null,
    };

    await fs.writeFile(process.env.TRILINE_DB_PATH!, JSON.stringify(dbPayload), 'utf8');
    await resetStoreForTests();

    const loaded = await listProjects();
    assert.equal(loaded.length, 1);
    const rec = loaded[0];
    assert.equal(rec.id, 'proj-recoverable');
    assert.equal(rec.title, 'Recoverable Film');
    assert.equal(rec.cues[0].id, 'cue-1');
    assert.equal(rec.cues[0].index, 1);
    assert.deepEqual(rec.styleConfig.lineOrder, ['target']);
    assert.equal(rec.styleConfig.baseColor, DEFAULT_STYLE_CONFIG.baseColor);
    assert.equal(rec.styleConfig.alignment, DEFAULT_STYLE_CONFIG.alignment);
    assert.ok(!rec.styleConfig.fontFamily.includes(','));
    assert.ok(!rec.styleConfig.fontFamily.includes('\n'));
    assert.ok(Number.isFinite(Date.parse(rec.updatedAt)));
  });
});

describe('Phase 3B (2): Export Validation, Edge Cases & Filename Sanitization', () => {
  it('validates export cues strictly and rejects missing cues, negative timestamps, and missing text fields', () => {
    assert.equal(validateExportCues(null).ok, false);
    assert.equal(validateExportCues([]).ok, false);
    assert.equal(validateExportCues(['not-an-object']).ok, false);
    assert.equal(validateExportCues([{ startMs: 1000, endMs: 2000 }]).ok, false);
    assert.equal(
      validateExportCues([
        { startMs: -50, endMs: 1000, baseText: 'Hi', targetText: 'Hallo', phoneticText: 'HAH-loh' },
      ]).ok,
      false,
    );
    assert.equal(
      validateExportCues([
        { startMs: 2000, endMs: 1000, baseText: 'Hi', targetText: 'Hallo', phoneticText: 'HAH-loh' },
      ]).ok,
      false,
    );
    assert.equal(
      validateExportCues([
        { startMs: 1000, endMs: 1000, baseText: ' ', targetText: '', phoneticText: '' },
      ]).ok,
      false,
    );

    // Zero-duration cue with valid text is accepted
    const zeroDur = validateExportCues([
      { startMs: 1500, endMs: 1500, baseText: 'Now!', targetText: '今！', phoneticText: 'ee-mah!' },
    ]);
    assert.equal(zeroDur.ok, true);
  });

  it('handles malformed styleConfig, special chars, Unicode, multiline dialogue, zero-duration, and NaN timestamps safely across SRT/VTT/ASS', () => {
    assert.equal(formatSrtTime(Number.NaN), '00:00:00,000');
    assert.equal(formatVttTime(-500), '00:00:00.000');
    assert.equal(formatAssTime(Number.POSITIVE_INFINITY), '0:00:00.00');

    const malformedStyle = {
      lineOrder: 'not-an-array',
      baseColor: '" onclick="evil()',
      targetColor: 12345,
      fontFamily: 'Noto Sans, Hack\nBreak',
      baseFontSize: Number.NaN,
      alignment: 999,
      srtIncludeColorTags: true,
      srtIncludeBom: false,
    } as unknown as AssStyleConfig;

    const edgeCues: TriLineCue[] = [
      {
        id: 'c1',
        index: 1,
        startMs: 1234,
        endMs: 1234, // zero-duration cue
        baseText: 'Line 1\nLine 2 --> {brace} & "quotes"',
        targetText: '日本語\r\n한국어 · العربية · Über 🚀',
        phoneticText: undefined as unknown as string, // missing field in direct call
      },
    ];

    const srt = generateSrtContent(edgeCues, malformedStyle);
    assert.ok(srt.includes('00:00:01,234 --> 00:00:01,234'));
    assert.ok(srt.includes('<font color="#FFFFFF">Line 1 Line 2 --> {brace} & "quotes"</font>'));
    assert.ok(srt.includes('日本語 한국어 · العربية · Über 🚀'));
    assert.ok(!srt.includes('onclick='));

    const vtt = generateVttContent(edgeCues, malformedStyle);
    assert.ok(vtt.startsWith('WEBVTT\n\n'));
    assert.ok(vtt.includes('00:00:01.234 --> 00:00:01.234'));
    // Arrow inside cue payload must be escaped so WebVTT timing parser isn't broken
    assert.ok(vtt.includes('Line 1 Line 2 —> {brace} & "quotes"'));
    assert.ok(!vtt.includes('Line 2 -->'));

    const ass = generateAssContent(edgeCues, malformedStyle, 12345 as unknown as string);
    assert.ok(ass.includes('Title: TriLine Studio Export'));
    assert.ok(ass.includes('Style: BaseLang,Noto Sans Hack Break,42,&H00FFFFFF,'));
    assert.ok(!ass.includes('NaN'));
    assert.ok(ass.includes('Dialogue: 0,0:00:01.23,0:00:01.23,BaseLang,,0,0,0,,Line 1 Line 2 --> (brace) & "quotes"\\N{\\rTargetLang}日本語 한국어 · العربية · Über 🚀'));
  });

  it('sanitizes unsafe export filenames and validates styleConfig input types', () => {
    assert.equal(sanitizeExportFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeExportFileName('...'), 'triline_subtitles');
    assert.equal(sanitizeExportFileName('   '), 'triline_subtitles');
    assert.equal(sanitizeExportFileName(12345), 'triline_subtitles');
    assert.equal(sanitizeExportFileName('日本語.srt'), 'triline_subtitles');
    assert.equal(sanitizeExportFileName('Parasite.2019.triline.srt'), 'Parasite.2019');
    assert.ok(sanitizeExportFileName('a'.repeat(250)).length <= 100);

    assert.equal(validateStyleConfigInput('not-object').ok, false);
    assert.equal(validateStyleConfigInput({ alignment: 5 }).ok, false);
    assert.equal(validateStyleConfigInput({ baseFontSize: 'big' }).ok, false);
    const cleaned = sanitizeStyleConfig({ baseFontSize: 9999, boxOpacity: -10 });
    assert.equal(cleaned.baseFontSize, 200);
    assert.equal(cleaned.boxOpacity, 0);
  });
});

describe('Phase 3B (3): ZIP & GZIP Subtitle Download Stress Tests', () => {
  it('selects best subtitle from multi-file ZIP skipping directories, __MACOSX forks, and READMEs', async () => {
    process.env.SUBDL_API_KEY = 'subdl-secret-key-999';
    const forcedSrt = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nSign\n', 'utf8');
    const fullSrt = Buffer.from(
      '1\n00:00:01,000 --> 00:00:03,000\nEntschuldigung, ist dieser Platz noch frei?\n\n2\n00:00:04,000 --> 00:00:06,000\nJa, bitte setzen Sie sich.\n',
      'utf8',
    );
    const zipBytes = buildCustomZip([
      { name: 'subs/', content: Buffer.alloc(0), compression: 0 },
      { name: '__MACOSX/._movie.srt', content: Buffer.from('\x00\x05\x16\x07binary-garbage') },
      { name: 'README.txt', content: Buffer.from('Subtitles readme', 'utf8') },
      { name: 'subs/movie.forced.srt', content: forcedSrt },
      { name: 'subs/movie.full.srt', content: fullSrt, useDataDescriptor: true },
    ]);

    const res = await downloadSubdlFile('/subtitle/multi.zip', {
      fetchFn: (async () => new Response(new Uint8Array(zipBytes), { status: 200 })) as typeof fetch,
    });
    assert.equal(res.fileName, 'subs/movie.full.srt');
    assert.ok(res.buffer.toString('utf8').includes('Entschuldigung'));
  });

  it('rejects corrupt ZIP, truncated ZIP, unsupported compression, and ZIP with no subtitle files cleanly', async () => {
    process.env.SUBDL_API_KEY = 'subdl-secret-key-999';

    // 1. Corrupt deflate payload inside ZIP
    const corruptZip = buildCustomZip([
      {
        name: 'broken.srt',
        content: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHi\n'),
        compression: 8,
        rawCompressedOverride: Buffer.from([0xff, 0xaa, 0x00, 0xde, 0xad, 0xbe, 0xef]),
      },
    ]);
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/corrupt.zip', {
          fetchFn: (async () => new Response(new Uint8Array(corruptZip), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /corrupt or truncated/i.test(err.message),
    );

    // 2. Truncated ZIP buffer
    const truncatedZip = corruptZip.subarray(0, 18);
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/truncated.zip', {
          fetchFn: (async () => new Response(new Uint8Array(truncatedZip), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /corrupt or truncated/i.test(err.message),
    );

    // 3. Unsupported compression method (14 = LZMA)
    const lzmaZip = buildCustomZip([
      {
        name: 'movie.srt',
        content: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHi\n'),
        compression: 14,
      },
    ]);
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/lzma.zip', {
          fetchFn: (async () => new Response(new Uint8Array(lzmaZip), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /unsupported compression method \(14\)/i.test(err.message),
    );

    // 4. ZIP with no subtitle files
    const noSubZip = buildCustomZip([
      { name: 'docs/', content: Buffer.alloc(0), compression: 0 },
      { name: 'docs/readme.txt', content: Buffer.from('No subs here') },
    ]);
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/nosubs.zip', {
          fetchFn: (async () => new Response(new Uint8Array(noSubZip), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /did not contain a readable/i.test(err.message),
    );

    const diag = getIntegrationsDiagnostics().find((d) => d.provider === 'subdl');
    assert.equal(diag?.verificationStatus, 'failed');
  });

  it('rejects corrupt GZIP, disguised JSON/HTML errors (including inside GZIP/ZIP), and decompression bombs', async () => {
    process.env.SUBDL_API_KEY = 'subdl-top-secret-xyz';
    process.env.OPENSUBTITLES_API_KEY = 'os-top-secret-xyz';

    // 1. Corrupt GZIP must map to errorCode='upstream', not 'network'
    const badGzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/bad.srt.gz', {
          fetchFn: (async () => new Response(new Uint8Array(badGzip), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /GZIP archive is corrupt or truncated/i.test(err.message),
    );

    // 2. JSON error response disguised as HTTP 200 download (with secret redaction)
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/json-err.srt', {
          fetchFn: (async () =>
            new Response(
              JSON.stringify({
                status: false,
                error: 'Rate limit reached for api_key=subdl-top-secret-xyz',
              }),
              { status: 200 },
            )) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'rate_limit' &&
        !err.message.includes('subdl-top-secret-xyz') &&
        err.message.includes('[REDACTED]'),
    );

    // 3. GZIP-compressed HTML error wall disguised as 200 OK
    const gzippedHtml = zlib.gzipSync(Buffer.from('<html><body>503 Service Unavailable</body></html>'));
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/html-in-gz.srt.gz', {
          fetchFn: (async () => new Response(new Uint8Array(gzippedHtml), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /HTML error page/i.test(err.message),
    );

    // 4. ZIP decompression bomb (tiny compressed bytes expanding beyond maxDecompressedBytes)
    const bombContent = Buffer.alloc(64 * 1024, 0x41); // 64 KB highly compressible 'AAAA...'
    const zipBomb = buildCustomZip([{ name: 'bomb.srt', content: bombContent, compression: 8 }]);
    assert.ok(zipBomb.length < 1024, 'ZIP bomb should be tiny compressed');

    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/bomb.zip', {
          maxDecompressedBytes: 4096,
          fetchFn: (async () => new Response(new Uint8Array(zipBomb), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /exceeded maximum allowed decompressed size/i.test(err.message),
    );

    // 5. ZIP bomb with spoofed small uncompressedSize header (caught by zlib maxOutputLength)
    const spoofedBomb = buildCustomZip([
      {
        name: 'spoofed.srt',
        content: bombContent,
        compression: 8,
        uncompressedSizeOverride: 100, // lies about size in ZIP header!
      },
    ]);
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/spoofed-bomb.zip', {
          maxDecompressedBytes: 4096,
          fetchFn: (async () => new Response(new Uint8Array(spoofedBomb), { status: 200 })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /exceeded maximum allowed decompressed size/i.test(err.message),
    );

    // 6. GZIP decompression bomb on OpenSubtitles download
    const gzBomb = zlib.gzipSync(bombContent);
    await assert.rejects(
      () =>
        downloadOpenSubtitleFile('12345', {
          maxDecompressedBytes: 4096,
          fetchFn: (async (input) => {
            if (String(input).endsWith('/api/v1/download')) {
              return new Response(
                JSON.stringify({ link: 'https://cdn.example.com/bomb.srt.gz', file_name: 'bomb.srt.gz' }),
                { status: 200 },
              );
            }
            return new Response(new Uint8Array(gzBomb), { status: 200 });
          }) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.errorCode === 'upstream' &&
        /exceeded maximum allowed decompressed size/i.test(err.message),
    );

    // 7. Malformed SubDL URL rejected cleanly with 400
    await assert.rejects(
      () => downloadSubdlFile('http://[invalid-url'),
      (err: unknown) => err instanceof ProviderRequestError && err.statusCode === 400,
    );
  });
});

describe('Phase 3B (4): AI Conversion Edge Cases Across All Modes & Long Files', () => {
  it('retries partial responses, missing/duplicate/out-of-range indexes, empty translations, and preserves originals across modes', async () => {
    const cues: BatchInputCue[] = [
      { index: 1, startMs: 1000, endMs: 2500, baseText: 'Hello there.', targetText: '' },
      { index: 2, startMs: 3000, endMs: 4500, baseText: 'Follow me.', targetText: '' },
    ];

    const badPayloads = [
      // Partial response (missing cue 2)
      JSON.stringify({
        items: [{ index: 1, baseText: 'Hello there.', targetText: 'Hallo dort.', phoneticText: 'HAH-loh dort.' }],
      }),
      // Duplicate index 1
      JSON.stringify({
        items: [
          { index: 1, baseText: 'Hello there.', targetText: 'Hallo dort.', phoneticText: 'HAH-loh dort.' },
          { index: 1, baseText: 'Follow me.', targetText: 'Folge mir.', phoneticText: 'FOL-guh meer.' },
        ],
      }),
      // Out-of-range index 99
      JSON.stringify({
        items: [
          { index: 1, baseText: 'Hello there.', targetText: 'Hallo dort.', phoneticText: 'HAH-loh dort.' },
          { index: 99, baseText: 'Follow me.', targetText: 'Folge mir.', phoneticText: 'FOL-guh meer.' },
        ],
      }),
      // Empty targetText translation
      JSON.stringify({
        items: [
          { index: 1, baseText: 'Hello there.', targetText: '   ', phoneticText: 'HAH-loh dort.' },
          { index: 2, baseText: 'Follow me.', targetText: 'Folge mir.', phoneticText: 'FOL-guh meer.' },
        ],
      }),
      // Missing cue index field
      JSON.stringify({
        items: [
          { baseText: 'Hello there.', targetText: 'Hallo dort.', phoneticText: 'HAH-loh dort.' },
          { index: 2, baseText: 'Follow me.', targetText: 'Folge mir.', phoneticText: 'FOL-guh meer.' },
        ],
      }),
    ];

    for (const bad of badPayloads) {
      let attempt = 0;
      const res = await processTriLineConversion({
        cues,
        mode: 'base-first',
        baseLang: 'English',
        targetLang: 'German',
        phoneticStyle: 'hyphenated',
        skipLineCache: true,
        retryDelayBaseMs: 0,
        onProgress: () => {},
        generateBatchFn: async () => {
          attempt++;
          if (attempt === 1) return bad;
          return JSON.stringify({
            items: [
              {
                index: 1,
                baseText: 'MODEL_TRIED_TO_REWRITE_BASE_1',
                targetText: 'Hallo dort.',
                phoneticText: 'HAH-loh dort.',
              },
              {
                index: 2,
                baseText: 'MODEL_TRIED_TO_REWRITE_BASE_2',
                targetText: 'Folge mir.',
                phoneticText: 'FOL-guh meer.',
              },
            ],
          });
        },
      });
      assert.equal(attempt, 2);
      assert.equal(res.cues[0].baseText, 'Hello there.');
      assert.equal(res.cues[1].baseText, 'Follow me.');
      assert.equal(res.cues[0].targetText, 'Hallo dort.');
    }
  });

  it('retries validation failure on cue 401/403 in a very long (425-cue) subtitle file without mistaking index for HTTP 401/403', async () => {
    const longCues: BatchInputCue[] = Array.from({ length: 425 }, (_, i) => ({
      index: i + 1,
      startMs: i * 1000,
      endMs: i * 1000 + 800,
      baseText: '',
      targetText: i % 50 === 0 ? 'Monsieur Dupont arrive.' : `Phrase numéro ${i + 1}.`,
    }));

    let failedCue401Once = false;
    let sawGlossaryWithDupontInFinalBatch = false;
    let sawPrecedingContextWithBothSidesInBatch21 = false;

    const result = await processTriLineConversion({
      cues: longCues,
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'French',
      phoneticStyle: 'hyphenated',
      skipLineCache: true,
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async ({ contents }) => {
        const payload = JSON.parse(contents) as {
          cuesToProcess: Array<{ index: number; targetText: string }>;
          readOnlyPrecedingContext: Array<{ baseText: string; targetText: string }>;
          readOnlyConsistencyGlossary: Array<{ targetText: string; baseText: string }>;
        };

        const has401 = payload.cuesToProcess.some((c) => c.index === 401);
        if (has401) {
          sawPrecedingContextWithBothSidesInBatch21 =
            payload.readOnlyPrecedingContext.length === 3 &&
            payload.readOnlyPrecedingContext.every((c) => Boolean(c.baseText) && Boolean(c.targetText));
          if (!failedCue401Once) {
            failedCue401Once = true;
            // Empty baseText for cue 401 -> error message includes "401"; MUST retry, NOT abort as HTTP 401!
            return JSON.stringify({
              items: payload.cuesToProcess.map((c) => ({
                index: c.index,
                baseText: c.index === 401 ? '' : `Line ${c.index}`,
                targetText: c.targetText,
                phoneticText: `fraz ${c.index}`,
              })),
            });
          }
        }

        if (payload.cuesToProcess.some((c) => c.index === 425)) {
          sawGlossaryWithDupontInFinalBatch = payload.readOnlyConsistencyGlossary.some(
            (g) => g.targetText === 'Monsieur Dupont arrive.',
          );
        }

        return JSON.stringify({
          items: payload.cuesToProcess.map((c) => ({
            index: c.index,
            baseText: c.targetText === 'Monsieur Dupont arrive.' ? 'Mr. Dupont is arriving.' : `Line ${c.index}`,
            targetText: 'REWRITE_ATTEMPT',
            phoneticText: `fraz ${c.index}`,
          })),
        });
      },
    });

    assert.equal(failedCue401Once, true);
    assert.equal(sawPrecedingContextWithBothSidesInBatch21, true);
    assert.equal(sawGlossaryWithDupontInFinalBatch, true);
    assert.equal(result.cues.length, 425);
    assert.equal(result.cues[400].index, 401);
    assert.equal(result.cues[400].targetText, 'Monsieur Dupont arrive.');
  });

  it('rejects forbidden scripts (Halfwidth Katakana, Greek, Thai) and punctuated slash-IPA in phonetics', async () => {
    const forbiddenOutputs = [
      'kon-nee-ｺﾝﾆﾁﾊ', // Halfwidth Katakana
      'ya-sas γεια', // Greek
      'sa-wat-dee สวัสดี', // Thai
      '/bohn-zhoor/.', // Slash-delimited IPA with punctuation
    ];

    for (const badPhonetic of forbiddenOutputs) {
      await assert.rejects(
        () =>
          processTriLineConversion({
            cues: [{ index: 1, startMs: 0, endMs: 1000, baseText: 'Hello', targetText: 'Bonjour' }],
            mode: 'dual-merge',
            baseLang: 'English',
            targetLang: 'French',
            phoneticStyle: 'hyphenated',
            skipLineCache: true,
            retryDelayBaseMs: 0,
            onProgress: () => {},
            generateBatchFn: async () =>
              JSON.stringify({
                items: [{ index: 1, baseText: 'Hello', targetText: 'Bonjour', phoneticText: badPhonetic }],
              }),
          }),
        /Non-Latin script leaked|Slash-delimited IPA/,
      );
    }
  });
});

describe('Phase 3B (5): Cinema Preview Word Selection, Speed Rescaling & Empty Project Safety', () => {
  it('isolates manual word selection to a single line and preserves paused word position when no manual word is set', () => {
    const tokens = tokenizeCueWords('Entschuldigung, ist dieser Platz frei?');
    const manual = { role: 'target' as const, index: 2 };

    // Selecting word index 2 in target line must NOT highlight any word in base or phonetic lines
    assert.equal(
      resolveLineActiveWordIndex({
        highlightWords: true,
        lineRole: 'target',
        tokens,
        isPlaying: false,
        pauseRemainingMs: 0,
        elapsedMs: 0,
        effectiveDurationMs: 2500,
        manualWord: manual,
      }),
      2,
    );
    assert.equal(
      resolveLineActiveWordIndex({
        highlightWords: true,
        lineRole: 'base',
        tokens: tokenizeCueWords('Excuse me, is this seat free?'),
        isPlaying: false,
        pauseRemainingMs: 0,
        elapsedMs: 0,
        effectiveDurationMs: 2500,
        manualWord: manual,
      }),
      -1,
    );
    assert.equal(
      resolveLineActiveWordIndex({
        highlightWords: true,
        lineRole: 'phonetic',
        tokens: tokenizeCueWords('ent-SHUL-dee-gung ist DEE-zer plats fry?'),
        isPlaying: false,
        pauseRemainingMs: 0,
        elapsedMs: 0,
        effectiveDurationMs: 2500,
        manualWord: manual,
      }),
      -1,
    );

    // Pausing mid-cue (elapsedMs=1500 of 2500ms = 60% -> token 3 of 5) preserves paused word instead of snapping to 0
    assert.equal(
      resolveLineActiveWordIndex({
        highlightWords: true,
        lineRole: 'target',
        tokens,
        isPlaying: false,
        pauseRemainingMs: 0,
        elapsedMs: 1500,
        effectiveDurationMs: 2500,
        manualWord: null,
      }),
      3,
    );
  });

  it('rescales elapsed timing cleanly when playback speed changes mid-cue without breaking word highlighting', () => {
    const cue = { startMs: 1000, endMs: 5000 }; // 4000ms base
    const durSlow = computeEffectiveCueDurationMs(cue, 0.5); // 8000ms
    const durFast = computeEffectiveCueDurationMs(cue, 1.5); // 2667ms
    const tokens = ['one', 'two', 'three', 'four', 'five'];

    const elapsedAtSlow = 4500; // 56.25% -> word index 2
    const wordBeforeSpeedChange = getActiveWordIndex(tokens, elapsedAtSlow, durSlow);
    const rescaled = rescaleElapsedForSpeedChange(elapsedAtSlow, durSlow, durFast);
    const wordAfterSpeedChange = getActiveWordIndex(tokens, rescaled, durFast);

    assert.equal(wordBeforeSpeedChange, 2);
    assert.equal(wordAfterSpeedChange, 2);
    assert.ok(rescaled < durFast, 'Rescaled elapsed must stay within new cue duration');

    // NaN / invalid speed & cue timing guards
    assert.equal(computeEffectiveCueDurationMs({ startMs: Number.NaN, endMs: 1000 }, Number.NaN), 2600);
    assert.equal(getActiveWordIndex(tokens, Number.NaN, Number.NaN), 0);
    assert.deepEqual(tokenizeCueWords(undefined as unknown as string), []);
    assert.equal(
      resolveCueTickCompletion({
        currentIndex: 0,
        totalCues: 0,
        repeatCurrentCue: true,
        pauseBetweenCuesMs: 500,
      }).nextPhase,
      'stopped',
    );
  });

  it('renders CinemaPreview cleanly with empty projects and malformed styleConfig without runtime errors', () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(CinemaPreview, {
        cues: [],
        styleConfig: { lineOrder: null } as unknown as AssStyleConfig,
        activeCueIndex: 5,
        onSelectCueIndex: () => {},
      }),
    );
    assert.ok(emptyHtml.includes('Upload a subtitle file or load a sample'));
    assert.ok(emptyHtml.includes('00:00:00.000 --&gt; 00:00:00.000'));

    const populatedHtml = renderToStaticMarkup(
      React.createElement(CinemaPreview, {
        cues: [
          {
            id: 'cue-1',
            index: 1,
            startMs: 1000,
            endMs: 3000,
            baseText: 'Good evening.',
            targetText: 'Guten Abend.',
            phoneticText: 'GOO-ten AH-bent.',
          },
        ],
        styleConfig: DEFAULT_STYLE_CONFIG,
        activeCueIndex: 0,
        onSelectCueIndex: () => {},
        learningControls: {
          showBase: true,
          showTarget: true,
          showPhonetic: true,
          highlightWords: true,
          playbackSpeed: 1,
          pauseBetweenCuesMs: 0,
          repeatCurrentCue: false,
        },
      }),
    );
    assert.ok(populatedHtml.includes('Guten'));
    assert.ok(populatedHtml.includes('Cue 1/1'));
  });
});
