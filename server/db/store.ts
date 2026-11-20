import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AssStyleConfig,
  ConversionJob,
  ConversionMode,
  PhoneticStyle,
  ProcessingOptions,
  SavedProject,
  TranslationStyle,
  TriLineCue,
} from '../../src/types/subtitle.ts';

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
export const DEFAULT_PROMPT_VERSION = 'v3';

export interface LineCacheEntry {
  baseText: string;
  targetText: string;
  phoneticText: string;
  updatedAt: string;
}

export interface PersistedJobRecord {
  job: ConversionJob;
  createdAt: string;
  updatedAt: string;
}

interface DatabaseSchema {
  version: number;
  projects: SavedProject[];
  lineCache: Record<string, LineCacheEntry>;
  jobs: Record<string, PersistedJobRecord>;
}

function getDbPaths(): { dataDir: string; dbPath: string } {
  const customPath = process.env.TRILINE_DB_PATH;
  if (customPath) {
    const resolved = path.resolve(customPath);
    return { dataDir: path.dirname(resolved), dbPath: resolved };
  }
  const dataDir = path.resolve(process.cwd(), 'data');
  return { dataDir, dbPath: path.join(dataDir, 'triline-db.json') };
}

let memoryDb: DatabaseSchema | null = null;
let loadedDbPath: string | null = null;
let loadPromise: Promise<DatabaseSchema> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Intended for test isolation when switching TRILINE_DB_PATH between tests.
 */
export async function resetStoreForTests(): Promise<void> {
  await writeQueue.catch(() => {});
  memoryDb = null;
  loadedDbPath = null;
  loadPromise = null;
  writeQueue = Promise.resolve();
}

async function ensureDbLoaded(): Promise<DatabaseSchema> {
  const { dataDir, dbPath } = getDbPaths();
  if (memoryDb && loadedDbPath === dbPath) {
    return memoryDb;
  }
  if (loadPromise && loadedDbPath === dbPath) {
    return loadPromise;
  }

  loadedDbPath = dbPath;
  loadPromise = (async () => {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(dbPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
      const rawProjects = Array.isArray(parsed.projects) ? parsed.projects : [];
      const validProjects = rawProjects.filter(
        (p): p is SavedProject =>
          Boolean(p) &&
          typeof p === 'object' &&
          typeof p.id === 'string' &&
          p.id.length > 0 &&
          typeof p.title === 'string' &&
          Array.isArray(p.cues) &&
          p.cues.every(
            (c) =>
              Boolean(c) &&
              typeof c === 'object' &&
              typeof c.startMs === 'number' &&
              Number.isFinite(c.startMs) &&
              typeof c.endMs === 'number' &&
              Number.isFinite(c.endMs) &&
              c.endMs >= c.startMs,
          ),
      );
      memoryDb = {
        version: parsed.version || 2,
        projects: validProjects,
        lineCache:
          parsed.lineCache && typeof parsed.lineCache === 'object' ? parsed.lineCache : {},
        jobs: parsed.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {},
      };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        // Back up corrupt database file rather than silently overwriting it
        const backupPath = `${dbPath}.corrupt.${Date.now()}`;
        await fs.copyFile(dbPath, backupPath).catch(() => {});
        console.error(
          `Corrupt database file detected at ${dbPath}; backed up to ${backupPath}.`,
          err,
        );
      }
      memoryDb = {
        version: 2,
        projects: [],
        lineCache: {},
        jobs: {},
      };
    }
    return memoryDb;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function persistDb(): Promise<void> {
  const { dataDir, dbPath } = getDbPaths();
  // Serialize writes strictly through writeQueue, recovering cleanly from prior errors,
  // and capture JSON.stringify inside the queued task so stale snapshots never overwrite newer state.
  const nextWrite = writeQueue
    .catch(() => {})
    .then(async () => {
      if (!memoryDb) return;
      await fs.mkdir(dataDir, { recursive: true });
      const snapshot = JSON.stringify(memoryDb);
      const tmpPath = `${dbPath}.tmp.${process.pid}.${crypto.randomUUID()}`;
      try {
        await fs.writeFile(tmpPath, snapshot, 'utf8');
        await fs.rename(tmpPath, dbPath);
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        throw err;
      }
    });

  writeQueue = nextWrite;
  await nextWrite;
}

export function buildProjectCacheKey(params: {
  movieId?: string;
  sourceHash: string;
  secondaryHash?: string;
  baseLang: string;
  targetLang: string;
  mode: ConversionMode;
  phoneticStyle: PhoneticStyle;
  translationStyle?: TranslationStyle;
  processingOptions: ProcessingOptions;
  model?: string;
  promptVersion?: string;
  alignmentOverridesHash?: string;
}): string {
  const payload = JSON.stringify({
    movieId: params.movieId || 'manual',
    sourceHash: params.sourceHash,
    secondaryHash: params.secondaryHash || '',
    baseLang: params.baseLang,
    targetLang: params.targetLang,
    mode: params.mode,
    phoneticStyle: params.phoneticStyle,
    translationStyle: params.translationStyle || 'natural',
    processingOptions: params.processingOptions,
    model: params.model || DEFAULT_GEMINI_MODEL,
    promptVersion: params.promptVersion || DEFAULT_PROMPT_VERSION,
    alignmentOverridesHash: params.alignmentOverridesHash || '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

export function buildLineCacheKey(params: {
  mode: ConversionMode;
  baseLang: string;
  targetLang: string;
  phoneticStyle: PhoneticStyle;
  translationStyle?: TranslationStyle;
  sourcePrimary: string;
  sourceSecondary?: string;
  model?: string;
  promptVersion?: string;
}): string {
  const normA = params.sourcePrimary.trim().replace(/\s+/g, ' ');
  const normB = (params.sourceSecondary || '').trim().replace(/\s+/g, ' ');
  const raw = JSON.stringify({
    mode: params.mode,
    baseLang: params.baseLang,
    targetLang: params.targetLang,
    phoneticStyle: params.phoneticStyle,
    translationStyle: params.translationStyle || 'natural',
    sourcePrimary: normA,
    sourceSecondary: normB,
    model: params.model || DEFAULT_GEMINI_MODEL,
    promptVersion: params.promptVersion || DEFAULT_PROMPT_VERSION,
  });
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export async function getCachedLine(key: string): Promise<LineCacheEntry | null> {
  const db = await ensureDbLoaded();
  return db.lineCache[key] || null;
}

export async function setCachedLines(
  entries: Array<{ key: string; value: LineCacheEntry }>,
): Promise<void> {
  if (entries.length === 0) return;
  const db = await ensureDbLoaded();
  for (const { key, value } of entries) {
    db.lineCache[key] = value;
  }
  await persistDb();
}

export async function findProjectByCacheKey(cacheKey: string): Promise<SavedProject | null> {
  const db = await ensureDbLoaded();
  return db.projects.find((p) => p.cacheKey === cacheKey) || null;
}

export async function listProjects(): Promise<SavedProject[]> {
  const db = await ensureDbLoaded();
  return [...db.projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function getProjectById(id: string): Promise<SavedProject | null> {
  const db = await ensureDbLoaded();
  return db.projects.find((p) => p.id === id) || null;
}

export async function saveProject(project: SavedProject): Promise<SavedProject> {
  const db = await ensureDbLoaded();
  const existingIdx = db.projects.findIndex(
    (p) => p.id === project.id || p.cacheKey === project.cacheKey,
  );
  if (existingIdx >= 0) {
    db.projects[existingIdx] = project;
  } else {
    db.projects.unshift(project);
  }
  await persistDb();
  return project;
}

export async function updateProject(
  id: string,
  patch: { cues?: TriLineCue[]; styleConfig?: AssStyleConfig; title?: string },
): Promise<SavedProject | null> {
  const db = await ensureDbLoaded();
  const idx = db.projects.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const current = db.projects[idx];
  const updated: SavedProject = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.cues !== undefined ? { cues: patch.cues } : {}),
    ...(patch.styleConfig !== undefined ? { styleConfig: patch.styleConfig } : {}),
    updatedAt: new Date().toISOString(),
  };
  db.projects[idx] = updated;
  await persistDb();
  return updated;
}

export async function deleteProject(id: string): Promise<boolean> {
  const db = await ensureDbLoaded();
  const before = db.projects.length;
  db.projects = db.projects.filter((p) => p.id !== id);
  if (db.projects.length !== before) {
    await persistDb();
    return true;
  }
  return false;
}

export async function upsertJob(job: ConversionJob): Promise<void> {
  const db = await ensureDbLoaded();
  const now = new Date().toISOString();
  const existing = db.jobs[job.jobId];
  db.jobs[job.jobId] = {
    job: { ...job },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  // Prune oldest completed/failed jobs beyond 100 entries to keep JSON bounded
  const jobIds = Object.keys(db.jobs);
  if (jobIds.length > 100) {
    const sorted = jobIds.sort(
      (a, b) =>
        new Date(db.jobs[a].updatedAt).getTime() - new Date(db.jobs[b].updatedAt).getTime(),
    );
    for (const oldId of sorted.slice(0, jobIds.length - 100)) {
      if (db.jobs[oldId].job.status === 'completed' || db.jobs[oldId].job.status === 'failed') {
        delete db.jobs[oldId];
      }
    }
  }

  await persistDb();
}

export async function getPersistedJob(jobId: string): Promise<ConversionJob | null> {
  const db = await ensureDbLoaded();
  return db.jobs[jobId]?.job || null;
}

/**
 * On server boot, transition any jobs left in `queued` or `processing` state
 * from a previous process crash/restart into a clear recoverable `failed` state.
 */
export async function recoverInterruptedJobs(): Promise<number> {
  const db = await ensureDbLoaded();
  let recovered = 0;
  const now = new Date().toISOString();
  for (const record of Object.values(db.jobs)) {
    if (record.job.status === 'queued' || record.job.status === 'processing') {
      record.job = {
        ...record.job,
        status: 'failed',
        estimatedRemainingSec: 0,
        error:
          'Server restarted while conversion was in progress. Completed batches remain cached — click Generate to resume.',
      };
      record.updatedAt = now;
      recovered++;
    }
  }
  if (recovered > 0) {
    await persistDb();
  }
  return recovered;
}

export async function getCacheStats(): Promise<{
  savedProjectCount: number;
  cachedLineCount: number;
}> {
  const db = await ensureDbLoaded();
  return {
    savedProjectCount: db.projects.length,
    cachedLineCount: Object.keys(db.lineCache).length,
  };
}
