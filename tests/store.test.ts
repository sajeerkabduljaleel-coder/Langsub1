import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getPersistedJob,
  getProjectById,
  recoverInterruptedJobs,
  resetStoreForTests,
  saveProject,
  setCachedLines,
  upsertJob,
} from '../server/db/store.ts';
import { DEFAULT_PROCESSING_OPTIONS, DEFAULT_STYLE_CONFIG, type SavedProject } from '../src/types/subtitle.ts';

let tmpDir: string;
let dbFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langsub-store-'));
  dbFile = path.join(tmpDir, 'triline-db.json');
  process.env.TRILINE_DB_PATH = dbFile;
  await resetStoreForTests();
});

afterEach(async () => {
  delete process.env.TRILINE_DB_PATH;
  await resetStoreForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Storage & Job Persistence Reliability', () => {
  it('handles concurrent writes atomically without corrupting JSON or losing data', async () => {
    const writes = Array.from({ length: 15 }, (_, i) =>
      setCachedLines([
        {
          key: `line-${i}`,
          value: {
            baseText: `Line ${i}`,
            targetText: `Zeile ${i}`,
            phoneticText: `TSY-luh ${i}`,
            updatedAt: new Date().toISOString(),
          },
        },
      ]),
    );

    const sampleProject: SavedProject = {
      id: 'proj-concurrent',
      cacheKey: 'ck-concurrent',
      title: 'Concurrent Test',
      baseLang: 'English',
      targetLang: 'German',
      mode: 'target-first',
      phoneticStyle: 'hyphenated',
      sourceFileName: 'test.srt',
      sourceFormat: 'srt',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cues: [],
      processingReport: {
        detectedEncoding: 'UTF-8',
        originalFormat: 'srt',
        totalInputCues: 0,
        sdhStrippedCount: 0,
        duplicatesRemovedCount: 0,
        mergedLineCount: 0,
        finalCueCount: 0,
        sdhRemovedSamples: [],
      },
      styleConfig: DEFAULT_STYLE_CONFIG,
    };

    await Promise.all([...writes, saveProject(sampleProject)]);

    // Simulate cold reload from disk
    await resetStoreForTests();
    const loadedProject = await getProjectById('proj-concurrent');
    assert.ok(loadedProject);
    assert.equal(loadedProject.title, 'Concurrent Test');

    const raw = await fs.readFile(dbFile, 'utf8');
    const parsed = JSON.parse(raw) as { lineCache: Record<string, unknown> };
    assert.equal(Object.keys(parsed.lineCache).length, 15);
  });

  it('recovers interrupted processing jobs cleanly across server restarts', async () => {
    await upsertJob({
      jobId: 'job-in-flight',
      status: 'processing',
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'Japanese',
      phoneticStyle: 'hyphenated',
      totalCues: 40,
      processedCues: 20,
      cacheHits: 0,
      apiBatchesCompleted: 1,
      apiBatchesTotal: 2,
      estimatedRemainingSec: 3,
    });

    await upsertJob({
      jobId: 'job-done',
      status: 'completed',
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'German',
      phoneticStyle: 'hyphenated',
      totalCues: 8,
      processedCues: 8,
      cacheHits: 0,
      apiBatchesCompleted: 1,
      apiBatchesTotal: 1,
      estimatedRemainingSec: 0,
      projectId: 'proj-1',
    });

    // Simulate server restart
    await resetStoreForTests();
    const recovered = await recoverInterruptedJobs();
    assert.equal(recovered, 1);

    const interrupted = await getPersistedJob('job-in-flight');
    assert.ok(interrupted);
    assert.equal(interrupted.status, 'failed');
    assert.match(interrupted.error || '', /Server restarted/);

    const completed = await getPersistedJob('job-done');
    assert.ok(completed);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.projectId, 'proj-1');
  });

  it('backs up corrupt database file instead of silently erasing evidence', async () => {
    await fs.writeFile(dbFile, '{not valid json!!!', 'utf8');
    await resetStoreForTests();
    const project = await getProjectById('missing');
    assert.equal(project, null);

    const files = await fs.readdir(tmpDir);
    assert.ok(files.some((f) => f.startsWith('triline-db.json.corrupt.')));
  });
});
