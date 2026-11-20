import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  downloadOpenSubtitleFile,
  downloadSubdlFile,
  getIntegrationsDiagnostics,
  ProviderRequestError,
  resetDiagnosticsForTests,
} from '../server/providers/integrations.ts';
import { parseSubtitleBuffer } from '../server/subtitles/parser.ts';
import { alignDualSubtitles } from '../server/subtitles/aligner.ts';
import {
  generateAssContent,
  generateSrtContent,
  generateVttContent,
} from '../server/subtitles/exporter.ts';
import { processTriLineConversion, type BatchInputCue } from '../server/ai/translator.ts';
import {
  buildProjectCacheKey,
  findProjectByCacheKey,
  getProjectById,
  listProjects,
  resetStoreForTests,
  saveProject,
} from '../server/db/store.ts';
import {
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_STYLE_CONFIG,
  type SavedProject,
} from '../src/types/subtitle.ts';

/**
 * Builds a minimal valid ZIP containing an optional directory entry (size=0)
 * and a bit-3 Data Descriptor file entry (local header compressedSize=0, real size in Central Directory).
 */
function buildZipWithDirectoryAndBit3Entry(fileName: string, content: Buffer): Buffer {
  const deflated = zlib.deflateRawSync(content);
  const crc = zlib.crc32(content);

  // Entry 1: directory "subtitles/" (0 bytes)
  const dirName = Buffer.from('subtitles/', 'utf8');
  const dirLocal = Buffer.alloc(30 + dirName.length);
  dirLocal.writeUInt32LE(0x04034b50, 0);
  dirLocal.writeUInt16LE(20, 4);
  dirLocal.writeUInt16LE(0, 6);
  dirLocal.writeUInt16LE(0, 8); // stored
  dirLocal.writeUInt16LE(dirName.length, 26);
  dirName.copy(dirLocal, 30);

  // Entry 2: subtitle file with bit-3 data descriptor (flags=0x0008, local sizes=0)
  const fileNameBuf = Buffer.from(fileName, 'utf8');
  const fileLocalOffset = dirLocal.length;
  const fileLocalHeader = Buffer.alloc(30 + fileNameBuf.length);
  fileLocalHeader.writeUInt32LE(0x04034b50, 0);
  fileLocalHeader.writeUInt16LE(20, 4);
  fileLocalHeader.writeUInt16LE(0x0008, 6); // bit 3 flag
  fileLocalHeader.writeUInt16LE(8, 8); // deflate
  fileLocalHeader.writeUInt16LE(fileNameBuf.length, 26);
  fileNameBuf.copy(fileLocalHeader, 30);

  const dataDesc = Buffer.alloc(16);
  dataDesc.writeUInt32LE(0x08074b50, 0);
  dataDesc.writeUInt32LE(crc >>> 0, 4);
  dataDesc.writeUInt32LE(deflated.length, 8);
  dataDesc.writeUInt32LE(content.length, 12);

  // Central Directory records
  const cd1 = Buffer.alloc(46 + dirName.length);
  cd1.writeUInt32LE(0x02014b50, 0);
  cd1.writeUInt16LE(20, 4);
  cd1.writeUInt16LE(20, 6);
  cd1.writeUInt16LE(dirName.length, 28);
  cd1.writeUInt32LE(0, 42);
  dirName.copy(cd1, 46);

  const cd2 = Buffer.alloc(46 + fileNameBuf.length);
  cd2.writeUInt32LE(0x02014b50, 0);
  cd2.writeUInt16LE(20, 4);
  cd2.writeUInt16LE(20, 6);
  cd2.writeUInt16LE(0x0008, 8);
  cd2.writeUInt16LE(8, 10);
  cd2.writeUInt32LE(crc >>> 0, 16);
  cd2.writeUInt32LE(deflated.length, 20);
  cd2.writeUInt32LE(content.length, 24);
  cd2.writeUInt16LE(fileNameBuf.length, 28);
  cd2.writeUInt32LE(fileLocalOffset, 42);
  fileNameBuf.copy(cd2, 46);

  const cdOffset = dirLocal.length + fileLocalHeader.length + deflated.length + dataDesc.length;
  const cdSize = cd1.length + cd2.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(2, 8);
  eocd.writeUInt16LE(2, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([dirLocal, fileLocalHeader, deflated, dataDesc, cd1, cd2, eocd]);
}

let tmpDir: string;
const origEnv = { ...process.env };

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langsub-phase3-'));
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

describe('Phase 3: Provider Payload & Download Hardening', () => {
  it('extracts subtitle from ZIP containing a 0-byte directory and bit-3 Data Descriptor entry', async () => {
    process.env.SUBDL_API_KEY = 'subdl-test-secret';
    const srtPayload = Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nHallo Welt!\n', 'utf8');
    const zipBytes = buildZipWithDirectoryAndBit3Entry('subtitles/movie.de.srt', srtPayload);

    const payload = await downloadSubdlFile('/subtitle/dir-bit3.zip', {
      fetchFn: (async () =>
        new Response(new Uint8Array(zipBytes), {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        })) as typeof fetch,
    });

    assert.equal(payload.fileName, 'subtitles/movie.de.srt');
    assert.equal(payload.buffer.toString('utf8'), srtPayload.toString('utf8'));
    const diag = getIntegrationsDiagnostics().find((d) => d.provider === 'subdl');
    assert.equal(diag?.verificationStatus, 'verified');
  });

  it('decompresses GZIP subtitle downloads and rejects HTML error walls cleanly', async () => {
    process.env.OPENSUBTITLES_API_KEY = 'os-test-secret';
    const vttPayload = Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nBonjour.\n', 'utf8');
    const gzBytes = zlib.gzipSync(vttPayload);

    const mockFetch: typeof fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/download')) {
        return new Response(
          JSON.stringify({ link: 'https://cdn.example.com/sub.vtt.gz', file_name: 'french.vtt.gz' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(new Uint8Array(gzBytes), { status: 200 });
    }) as typeof fetch;

    const downloaded = await downloadOpenSubtitleFile('424242', { fetchFn: mockFetch });
    assert.equal(downloaded.fileName, 'french.vtt');
    assert.ok(downloaded.buffer.toString('utf8').includes('Bonjour.'));

    // HTML error page disguised as HTTP 200 must throw ProviderRequestError
    await assert.rejects(
      () =>
        downloadSubdlFile('/subtitle/html-wall.srt', {
          fetchFn: (async () =>
            new Response('<!DOCTYPE html><html><body>Rate limited</body></html>', {
              status: 200,
            })) as typeof fetch,
        }),
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.message.includes('HTML error page'),
    );
  });

  it('rejects non-numeric or zero OpenSubtitles file IDs cleanly', async () => {
    process.env.OPENSUBTITLES_API_KEY = 'os-test-secret';
    await assert.rejects(
      () => downloadOpenSubtitleFile('   '),
      (err: unknown) => err instanceof ProviderRequestError && err.statusCode === 400,
    );
    await assert.rejects(
      () => downloadOpenSubtitleFile('0'),
      (err: unknown) => err instanceof ProviderRequestError && err.statusCode === 400,
    );
  });
});

describe('Phase 3: Conversion Workflows (Target-First, Base-First, Dual-Merge) & Multilingual Output', () => {
  it('runs Target-First across German, French, Japanese, and Korean preserving originals & enriching cross-batch context', async () => {
    const cues: BatchInputCue[] = Array.from({ length: 22 }, (_, i) => {
      const lines = [
        'Entschuldigung, ist dieser Platz frei?',
        'Oui, asseyez-vous je vous en prie.',
        'もうすぐ終点ですね。',
        '감사합니다, 조심히 가세요.',
      ];
      return {
        index: i + 1,
        startMs: (i + 1) * 1500,
        endMs: (i + 1) * 1500 + 1200,
        baseText: '',
        targetText: lines[i % lines.length],
      };
    });

    let batch2PrecedingContextHadBothSides = false;
    const res = await processTriLineConversion({
      cues,
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'Korean',
      phoneticStyle: 'standard',
      translationStyle: 'colloquial',
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async ({ contents }) => {
        const parsed = JSON.parse(contents) as {
          readOnlyPrecedingContext: Array<{ baseText: string; targetText: string }>;
          cuesToProcess: Array<{ index: number; targetText: string }>;
        };
        if (parsed.readOnlyPrecedingContext.length > 0) {
          batch2PrecedingContextHadBothSides = parsed.readOnlyPrecedingContext.every(
            (c) => Boolean(c.baseText.trim()) && Boolean(c.targetText.trim()),
          );
        }
        return JSON.stringify({
          items: parsed.cuesToProcess.map((c) => ({
            index: c.index,
            baseText: `Natural line ${c.index}`,
            targetText: 'SHOULD_NOT_OVERWRITE',
            phoneticText: `gam-sa-ham-ni-da ${c.index}`,
          })),
        });
      },
    });

    assert.equal(res.cues.length, 22);
    assert.equal(batch2PrecedingContextHadBothSides, true);
    assert.equal(res.cues[0].targetText, 'Entschuldigung, ist dieser Platz frei?');
    assert.equal(res.cues[3].targetText, '감사합니다, 조심히 가세요.');
  });

  it('rejects leaked Korean Jamo characters in phonetic output', async () => {
    const cues: BatchInputCue[] = [
      { index: 1, startMs: 500, endMs: 2000, baseText: '', targetText: '감사합니다.' },
    ];
    await assert.rejects(
      () =>
        processTriLineConversion({
          cues,
          mode: 'target-first',
          baseLang: 'English',
          targetLang: 'Korean',
          phoneticStyle: 'hyphenated',
          retryDelayBaseMs: 0,
          onProgress: () => {},
          generateBatchFn: async () =>
            JSON.stringify({
              items: [
                {
                  index: 1,
                  baseText: 'Thank you.',
                  targetText: '감사합니다.',
                  phoneticText: 'gam-sa-ㅎam-ni-da',
                },
              ],
            }),
        }),
      /Non-Latin script leaked/,
    );
  });

  it('runs Base-First and Dual-Merge preserving unmatched cues without silent drops', async () => {
    // Base-first (English -> French)
    const baseInput: BatchInputCue[] = [
      { index: 1, startMs: 1000, endMs: 3100, baseText: 'Wait for me at the corner.', targetText: '' },
    ];
    const baseFirstRes = await processTriLineConversion({
      cues: baseInput,
      mode: 'base-first',
      baseLang: 'English',
      targetLang: 'French',
      phoneticStyle: 'flowing',
      translationStyle: 'formal',
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async () =>
        JSON.stringify({
          items: [
            {
              index: 1,
              baseText: 'MODEL_SHOULD_NOT_ALTER_BASE',
              targetText: 'Attendez-moi au coin de la rue.',
              phoneticText: 'ah-tahn-deh mwah oh kweh duh lah rew.',
            },
          ],
        }),
    });
    assert.equal(baseFirstRes.cues[0].baseText, 'Wait for me at the corner.');
    assert.equal(baseFirstRes.cues[0].targetText, 'Attendez-moi au coin de la rue.');

    // Dual-merge with unmatched target AND unmatched base cues
    const targetParsed = parseSubtitleBuffer(
      Buffer.from(
        [
          '1',
          '00:00:01,000 --> 00:00:03,000',
          'もうすぐ終点ですね。',
          '',
          '2',
          '00:00:04,000 --> 00:00:06,000',
          '忘れ物をしないでください。',
          '',
        ].join('\n'),
        'utf8',
      ),
      'ja.srt',
      DEFAULT_PROCESSING_OPTIONS,
    );
    const baseParsed = parseSubtitleBuffer(
      Buffer.from(
        [
          '1',
          '00:00:01,000 --> 00:00:03,000',
          'Almost at the last stop.',
          '',
          '2',
          '00:00:08,000 --> 00:00:10,000',
          'Thank you for riding with us.',
          '',
        ].join('\n'),
        'utf8',
      ),
      'en.srt',
      DEFAULT_PROCESSING_OPTIONS,
    );

    const alignment = alignDualSubtitles(targetParsed.cues, baseParsed.cues);
    assert.equal(alignment.aligned.length, 3);
    assert.equal(alignment.stats.unmatchedTarget, 1);
    assert.equal(alignment.stats.unmatchedBase, 1);

    const dualInput: BatchInputCue[] = alignment.aligned.map((a) => ({
      index: a.index,
      startMs: a.startMs,
      endMs: a.endMs,
      targetText: a.targetText,
      baseText: a.baseText,
      alignmentConfidence: a.confidence,
      alignmentRelationship: a.relationship,
    }));

    const dualRes = await processTriLineConversion({
      cues: dualInput,
      mode: 'dual-merge',
      baseLang: 'English',
      targetLang: 'Japanese',
      phoneticStyle: 'hyphenated',
      translationStyle: 'natural',
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async ({ contents }) => {
        const payload = JSON.parse(contents) as { cuesToProcess: BatchInputCue[] };
        return JSON.stringify({
          items: payload.cuesToProcess.map((c) => ({
            index: c.index,
            baseText: c.baseText || 'Please do not forget your belongings.',
            targetText: c.targetText || 'ご乗車ありがとうございました。',
            phoneticText: `ph-${c.index}`,
          })),
        });
      },
    });

    assert.equal(dualRes.cues.length, 3);
    assert.equal(dualRes.cues[0].startMs, 1000);
    assert.equal(dualRes.cues[1].targetText, '忘れ物をしないでください。');
    assert.equal(dualRes.cues[2].baseText, 'Thank you for riding with us.');
    assert.equal(dualRes.cues[2].targetText, 'ご乗車ありがとうございました。');
  });
});

describe('Phase 3: Persistence, Restart Reopening, Corrupt Record Filtering & Exports', () => {
  it('persists projects across simulated server restart, rejects malformed records safely, and exports SRT/VTT/ASS', async () => {
    const cacheKey = buildProjectCacheKey({
      sourceHash: 'hash-1',
      baseLang: 'English',
      targetLang: 'German',
      mode: 'target-first',
      phoneticStyle: 'standard',
      translationStyle: 'formal',
      processingOptions: DEFAULT_PROCESSING_OPTIONS,
    });

    const project: SavedProject = {
      id: 'proj-phase3-1',
      cacheKey,
      title: 'Berlin Cafe',
      baseLang: 'English',
      targetLang: 'German',
      mode: 'target-first',
      phoneticStyle: 'standard',
      translationStyle: 'formal',
      sourceFileName: 'berlin.srt',
      sourceFormat: 'srt',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cues: [
        {
          id: 'cue-1',
          index: 1,
          startMs: 1200,
          endMs: 3450,
          baseText: 'Excuse me, is this seat taken?',
          targetText: 'Entschuldigen Sie, ist dieser Platz frei?',
          phoneticText: 'ent-SHOOL-dee-gen zee ist DEE-zer plahts fry?',
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
      styleConfig: {
        ...DEFAULT_STYLE_CONFIG,
        lineOrder: ['target', 'phonetic', 'base'],
      },
    };

    await saveProject(project);

    // Inject an invalid/incomplete project entry on disk to simulate malformed persistence data
    const dbRaw = JSON.parse(await fs.readFile(process.env.TRILINE_DB_PATH!, 'utf8')) as {
      version: number;
      projects: unknown[];
      lineCache: Record<string, unknown>;
      jobs: Record<string, unknown>;
    };
    dbRaw.projects.push({ id: 'broken-no-cues', title: 'Broken', cues: 'invalid' });
    dbRaw.projects.push({
      id: 'broken-bad-time',
      title: 'BadTime',
      cues: [{ id: 'c1', index: 1, startMs: 5000, endMs: 1000, baseText: 'a', targetText: 'b', phoneticText: 'c' }],
    });
    await fs.writeFile(process.env.TRILINE_DB_PATH!, JSON.stringify(dbRaw), 'utf8');

    // Simulate server restart
    await resetStoreForTests();

    const loadedList = await listProjects();
    assert.equal(loadedList.length, 1);
    const reopened = await getProjectById('proj-phase3-1');
    assert.ok(reopened);
    assert.equal(reopened.translationStyle, 'formal');
    assert.equal(reopened.phoneticStyle, 'standard');

    const byKey = await findProjectByCacheKey(cacheKey);
    assert.equal(byKey?.id, 'proj-phase3-1');

    // Verify all 3 export formats preserve timestamps and custom lineOrder
    const srt = generateSrtContent(reopened.cues, reopened.styleConfig);
    const vtt = generateVttContent(reopened.cues, reopened.styleConfig);
    const ass = generateAssContent(reopened.cues, reopened.styleConfig, reopened.title);

    assert.ok(srt.includes('00:00:01,200 --> 00:00:03,450'));
    assert.ok(vtt.includes('00:00:01.200 --> 00:00:03.450'));
    assert.ok(ass.includes('Dialogue: 0,0:00:01.20,0:00:03.45,TargetLang,'));
  });
});
