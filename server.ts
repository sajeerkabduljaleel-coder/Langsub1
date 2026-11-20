import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_STYLE_CONFIG,
  type AlignedCuePair,
  type AlignmentStats,
  type AssStyleConfig,
  type ConversionJob,
  type ConversionMode,
  type IntegrationProviderId,
  type MovieMetadata,
  type ParsedSubtitleResult,
  type PhoneticStyle,
  type ProcessingOptions,
  type SavedProject,
  type SubtitleProviderId,
  type TranslationStyle,
  type TriLineCue,
} from './src/types/subtitle.ts';
import { parseSubtitleBuffer } from './server/subtitles/parser.ts';
import { alignDualSubtitles } from './server/subtitles/aligner.ts';
import {
  generateAssContent,
  generateSrtContent,
  generateVttContent,
} from './server/subtitles/exporter.ts';
import {
  buildProjectCacheKey,
  deleteProject,
  findProjectByCacheKey,
  getCacheStats,
  getPersistedJob,
  getProjectById,
  listProjects,
  recoverInterruptedJobs,
  saveProject,
  updateProject,
  upsertJob,
} from './server/db/store.ts';
import { processTriLineConversion, type BatchInputCue } from './server/ai/translator.ts';
import {
  downloadOpenSubtitleFile,
  downloadSubdlFile,
  getIntegrationsDiagnostics,
  getIntegrationsStatus,
  ProviderRequestError,
  sanitizeProviderMessage,
  searchAllSubtitleProviders,
  searchTmdb,
  verifyProviderConnection,
} from './server/providers/integrations.ts';

const PORT = Number(process.env.PORT) || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const jobs = new Map<string, ConversionJob>();
const jobSubscribers = new Map<string, Set<express.Response>>();

function emitJobUpdate(job: ConversionJob, persist = false) {
  jobs.set(job.jobId, job);
  if (persist) {
    void upsertJob(job).catch((err) => {
      console.error('Failed to persist job state:', err);
    });
  }
  const subs = jobSubscribers.get(job.jobId);
  if (!subs) return;
  const payload = `data: ${JSON.stringify(job)}\n\n`;
  for (const res of subs) {
    res.write(payload);
  }
}

function parseJsonOption<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function startServer() {
  const recoveredCount = await recoverInterruptedJobs();
  if (recoveredCount > 0) {
    console.log(`Recovered ${recoveredCount} interrupted conversion job(s) from previous session.`);
  }

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/integrations/status', async (_req, res) => {
    const status = getIntegrationsStatus();
    const diagnostics = getIntegrationsDiagnostics();
    const cacheStats = await getCacheStats();
    res.json({ status, diagnostics, cacheStats });
  });

  app.post('/api/integrations/test', async (req, res) => {
    const { provider } = (req.body || {}) as {
      provider?: IntegrationProviderId | 'all';
    };
    const validProviders: IntegrationProviderId[] = [
      'gemini',
      'tmdb',
      'opensubtitles',
      'subdl',
    ];
    if (provider && provider !== 'all' && !validProviders.includes(provider)) {
      return res.status(400).json({ error: 'Unknown integration provider.' });
    }

    const targets =
      !provider || provider === 'all' ? validProviders : [provider];

    await Promise.allSettled(targets.map((p) => verifyProviderConnection(p)));
    res.json({
      status: getIntegrationsStatus(),
      diagnostics: getIntegrationsDiagnostics(),
    });
  });

  // TMDB Search
  app.get('/api/tmdb/search', async (req, res) => {
    const query = String(req.query.query || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required.' });
    }
    try {
      const result = await searchTmdb(query);
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof ProviderRequestError) {
        const httpStatus =
          error.errorCode === 'rate_limit'
            ? 429
            : error.errorCode === 'timeout'
              ? 504
              : 502;
        return res.status(httpStatus).json({
          error: error.message,
          errorCode: error.errorCode,
        });
      }
      const message = sanitizeProviderMessage(
        error instanceof Error ? error.message : 'TMDB search failed.',
      );
      res.status(502).json({ error: message });
    }
  });

  // Subtitle Providers Search (OpenSubtitles + SubDL) — concurrent & fault-isolated
  app.get('/api/subtitles/provider-search', async (req, res) => {
    const query = String(req.query.query || '').trim();
    const tmdbId = req.query.tmdbId ? String(req.query.tmdbId) : undefined;
    const language = req.query.language ? String(req.query.language) : undefined;
    const rawProvider = String(req.query.provider || 'all');

    if (
      rawProvider !== 'all' &&
      rawProvider !== 'opensubtitles' &&
      rawProvider !== 'subdl'
    ) {
      return res.status(400).json({ error: 'Invalid subtitle provider filter.' });
    }

    if (!query && !tmdbId) {
      return res
        .status(400)
        .json({ error: 'Provide a search title query or TMDB ID.' });
    }

    try {
      const out = await searchAllSubtitleProviders({
        query,
        tmdbId,
        language,
        provider: rawProvider as 'all' | SubtitleProviderId,
      });
      res.json(out);
    } catch (error: unknown) {
      const message = sanitizeProviderMessage(
        error instanceof Error ? error.message : 'Provider subtitle search failed.',
      );
      res.status(502).json({ error: message });
    }
  });

  // Download subtitle from OpenSubtitles or Subdl & parse immediately
  app.post('/api/subtitles/provider-download', async (req, res) => {
    const { provider, downloadRef, options } = req.body as {
      provider?: 'opensubtitles' | 'subdl';
      downloadRef?: string;
      options?: ProcessingOptions;
    };

    if (!provider || !downloadRef) {
      return res.status(400).json({ error: 'provider and downloadRef are required.' });
    }

    try {
      const downloaded =
        provider === 'opensubtitles'
          ? await downloadOpenSubtitleFile(downloadRef)
          : await downloadSubdlFile(downloadRef);

      const parsed = parseSubtitleBuffer(
        downloaded.buffer,
        downloaded.fileName,
        options || DEFAULT_PROCESSING_OPTIONS,
      );

      if (parsed.cues.length === 0) {
        return res.status(422).json({
          error: 'Downloaded subtitle file contained no readable subtitle cues.',
        });
      }

      res.json({
        parsed,
        rawBase64: downloaded.buffer.toString('base64'),
      });
    } catch (error: unknown) {
      if (error instanceof ProviderRequestError) {
        const httpStatus =
          error.errorCode === 'rate_limit'
            ? 429
            : error.errorCode === 'timeout'
              ? 504
              : error.statusCode === 400
                ? 400
                : 502;
        return res.status(httpStatus).json({
          error: error.message,
          errorCode: error.errorCode,
        });
      }
      const message = sanitizeProviderMessage(
        error instanceof Error ? error.message : 'Failed to download provider subtitle.',
      );
      res.status(502).json({ error: message });
    }
  });

  // Parse uploaded or raw text subtitle file asynchronously
  app.post('/api/subtitles/parse', upload.single('file'), async (req, res) => {
    try {
      const options = parseJsonOption<ProcessingOptions>(
        req.body?.options,
        DEFAULT_PROCESSING_OPTIONS,
      );

      let buffer: Buffer;
      let fileName = String(req.body?.fileName || 'subtitle.srt');

      if (req.file) {
        buffer = req.file.buffer;
        fileName = req.file.originalname || fileName;
      } else if (typeof req.body?.rawText === 'string') {
        buffer = Buffer.from(req.body.rawText, 'utf8');
      } else if (typeof req.body?.rawBase64 === 'string') {
        buffer = Buffer.from(req.body.rawBase64, 'base64');
      } else {
        return res.status(400).json({ error: 'No subtitle file or text provided.' });
      }

      const parsed = parseSubtitleBuffer(buffer, fileName, options);
      if (parsed.cues.length === 0) {
        return res.status(422).json({
          error:
            'No valid subtitle cues could be parsed from this file. Check that it is valid SRT, VTT, or ASS format.',
        });
      }

      res.json({
        parsed,
        rawBase64: buffer.toString('base64'),
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to parse subtitle file.';
      res.status(500).json({ error: message });
    }
  });

  // Preview alignment for Dual-File Merge before running AI
  app.post('/api/subtitles/align-preview', async (req, res) => {
    try {
      const { targetParsed, baseParsed } = req.body as {
        targetParsed?: ParsedSubtitleResult;
        baseParsed?: ParsedSubtitleResult;
      };

      if (!targetParsed?.cues || !baseParsed?.cues) {
        return res.status(400).json({ error: 'Both target and base parsed cues are required.' });
      }

      const alignment = alignDualSubtitles(targetParsed.cues, baseParsed.cues);
      res.json(alignment);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Dual-file alignment failed.';
      res.status(500).json({ error: message });
    }
  });

  // Start async three-line conversion job
  app.post('/api/jobs/convert', async (req, res) => {
    try {
      const {
        mode,
        baseLang,
        targetLang,
        phoneticStyle,
        translationStyle: rawTranslationStyle,
        processingOptions,
        styleConfig,
        primaryParsed,
        secondaryParsed,
        alignedPairs,
        alignmentStats,
        movieMetadata,
        forceRegenerate,
      } = req.body as {
        mode: ConversionMode;
        baseLang: string;
        targetLang: string;
        phoneticStyle: PhoneticStyle;
        translationStyle?: TranslationStyle;
        processingOptions: ProcessingOptions;
        styleConfig?: AssStyleConfig;
        primaryParsed: ParsedSubtitleResult;
        secondaryParsed?: ParsedSubtitleResult;
        alignedPairs?: AlignedCuePair[];
        alignmentStats?: AlignmentStats;
        movieMetadata?: MovieMetadata;
        forceRegenerate?: boolean;
      };

      const validTranslationStyles: TranslationStyle[] = [
        'natural',
        'literal',
        'colloquial',
        'formal',
      ];
      const translationStyle: TranslationStyle =
        rawTranslationStyle && validTranslationStyles.includes(rawTranslationStyle)
          ? rawTranslationStyle
          : 'natural';

      if (!primaryParsed?.cues?.length) {
        return res.status(400).json({ error: 'Primary subtitle cues are required.' });
      }
      if (!['target-first', 'base-first', 'dual-merge'].includes(mode)) {
        return res.status(400).json({ error: 'Unsupported conversion mode.' });
      }
      if (mode === 'dual-merge' && !secondaryParsed?.cues?.length) {
        return res.status(400).json({
          error: 'Dual-File Merge requires both primary and secondary subtitle cues.',
        });
      }

      const hasManualAlignedPairs = Array.isArray(alignedPairs) && alignedPairs.length > 0;
      const alignmentOverridesHash = hasManualAlignedPairs
        ? crypto
            .createHash('sha256')
            .update(
              JSON.stringify(
                alignedPairs.map((a) => ({
                  s: a.startMs,
                  e: a.endMs,
                  t: a.targetText,
                  b: a.baseText,
                })),
              ),
            )
            .digest('hex')
            .slice(0, 16)
        : '';

      const effectiveStyle: AssStyleConfig = {
        ...DEFAULT_STYLE_CONFIG,
        ...(styleConfig || {}),
      };

      const projectCacheKey = buildProjectCacheKey({
        movieId: movieMetadata?.movieId,
        sourceHash: primaryParsed.sourceHash,
        secondaryHash: secondaryParsed?.sourceHash,
        baseLang,
        targetLang,
        mode,
        phoneticStyle,
        translationStyle,
        processingOptions: processingOptions || DEFAULT_PROCESSING_OPTIONS,
        alignmentOverridesHash,
      });

      // Check full-project cache first unless explicitly bypassing
      if (!forceRegenerate) {
        const cachedProject = await findProjectByCacheKey(projectCacheKey);
        if (cachedProject) {
          const jobId = crypto.randomUUID();
          const completedJob: ConversionJob = {
            jobId,
            status: 'completed',
            mode,
            baseLang,
            targetLang,
            phoneticStyle,
            translationStyle,
            totalCues: cachedProject.cues.length,
            processedCues: cachedProject.cues.length,
            cacheHits: cachedProject.cues.length,
            apiBatchesCompleted: 0,
            apiBatchesTotal: 0,
            estimatedRemainingSec: 0,
            fromProjectCache: true,
            projectId: cachedProject.id,
          };
          jobs.set(jobId, completedJob);
          await upsertJob(completedJob);
          return res.json({ job: completedJob, cachedProject });
        }
      }

      // Prepare batch inputs depending on conversion mode
      let inputCues: BatchInputCue[] = [];
      const report = { ...primaryParsed.report };

      if (hasManualAlignedPairs && (mode === 'dual-merge' || (mode === 'base-first' && secondaryParsed?.cues?.length))) {
        if (alignmentStats) {
          report.alignmentStats = alignmentStats;
        }
        inputCues = alignedPairs.map((a, idx) => ({
          index: idx + 1,
          startMs: a.startMs,
          endMs: a.endMs,
          targetText: a.targetText,
          baseText: a.baseText,
          alignmentConfidence: a.confidence,
          alignmentRelationship: a.relationship,
        }));
      } else if (mode === 'dual-merge' && secondaryParsed?.cues?.length) {
        const { aligned, stats } = alignDualSubtitles(
          primaryParsed.cues,
          secondaryParsed.cues,
        );
        report.alignmentStats = stats;
        inputCues = aligned.map((a) => ({
          index: a.index,
          startMs: a.startMs,
          endMs: a.endMs,
          targetText: a.targetText,
          baseText: a.baseText,
          alignmentConfidence: a.confidence,
          alignmentRelationship: a.relationship,
        }));
      } else if (mode === 'base-first') {
        if (secondaryParsed?.cues?.length) {
          // Optional fetched target file paired with base file
          const { aligned, stats } = alignDualSubtitles(
            secondaryParsed.cues,
            primaryParsed.cues,
          );
          report.alignmentStats = stats;
          inputCues = aligned.map((a) => ({
            index: a.index,
            startMs: a.startMs,
            endMs: a.endMs,
            targetText: a.targetText,
            baseText: a.baseText,
            alignmentConfidence: a.confidence,
            alignmentRelationship: a.relationship,
          }));
        } else {
          inputCues = primaryParsed.cues.map((c) => ({
            index: c.index,
            startMs: c.startMs,
            endMs: c.endMs,
            baseText: c.text,
            targetText: '',
          }));
        }
      } else {
        // target-first
        inputCues = primaryParsed.cues.map((c) => ({
          index: c.index,
          startMs: c.startMs,
          endMs: c.endMs,
          baseText: '',
          targetText: c.text,
        }));
      }

      const jobId = crypto.randomUUID();
      const initialJob: ConversionJob = {
        jobId,
        status: 'processing',
        mode,
        baseLang,
        targetLang,
        phoneticStyle,
        translationStyle,
        totalCues: inputCues.length,
        processedCues: 0,
        cacheHits: 0,
        apiBatchesCompleted: 0,
        apiBatchesTotal: Math.ceil(inputCues.length / 20),
        estimatedRemainingSec: Math.ceil(inputCues.length / 20) * 3,
      };
      jobs.set(jobId, initialJob);
      await upsertJob(initialJob);

      // Run conversion asynchronously so request returns immediately with jobId
      void (async () => {
        try {
          const { cues: convertedCues, cacheHits } = await processTriLineConversion({
            cues: inputCues,
            mode,
            baseLang,
            targetLang,
            phoneticStyle,
            translationStyle,
            skipLineCache: Boolean(forceRegenerate),
            onProgress: (progress) => {
              const current = jobs.get(jobId);
              if (!current) return;
              emitJobUpdate(
                {
                  ...current,
                  ...progress,
                  status: 'processing',
                },
                progress.apiBatchesCompleted > 0,
              );
            },
          });

          const now = new Date().toISOString();
          const projectId = crypto.randomUUID();
          const projectTitle =
            movieMetadata?.title ||
            primaryParsed.fileName.replace(/\.(srt|vtt|ass|ssa)$/i, '');

          const saved: SavedProject = {
            id: projectId,
            cacheKey: projectCacheKey,
            title: projectTitle,
            movieId: movieMetadata?.movieId,
            posterUrl: movieMetadata?.posterUrl,
            releaseYear: movieMetadata?.releaseYear,
            mediaType: movieMetadata?.mediaType,
            baseLang,
            targetLang,
            mode,
            phoneticStyle,
            translationStyle,
            sourceFileName: primaryParsed.fileName,
            sourceFormat: primaryParsed.report.originalFormat,
            createdAt: now,
            updatedAt: now,
            cues: convertedCues,
            processingReport: report,
            styleConfig: effectiveStyle,
          };

          await saveProject(saved);

          const current = jobs.get(jobId);
          if (current) {
            const finalJob: ConversionJob = {
              ...current,
              status: 'completed',
              processedCues: convertedCues.length,
              cacheHits,
              estimatedRemainingSec: 0,
              projectId,
            };
            await upsertJob(finalJob);
            emitJobUpdate(finalJob, false);
          }
        } catch (err: unknown) {
          const current = jobs.get(jobId);
          const rawMessage =
            err instanceof Error ? err.message : 'Subtitle conversion failed.';
          const message = sanitizeProviderMessage(rawMessage);
          if (current) {
            const failedJob: ConversionJob = {
              ...current,
              status: 'failed',
              estimatedRemainingSec: 0,
              error: message,
            };
            await upsertJob(failedJob);
            emitJobUpdate(failedJob, false);
          }
        }
      })();

      res.json({ job: initialJob });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start job.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/jobs/:jobId', async (req, res) => {
    const job = jobs.get(req.params.jobId) || (await getPersistedJob(req.params.jobId));
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    res.json({ job });
  });

  app.get('/api/jobs/:jobId/stream', async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId) || (await getPersistedJob(jobId));
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify(job)}\n\n`);

    let set = jobSubscribers.get(jobId);
    if (!set) {
      set = new Set();
      jobSubscribers.set(jobId, set);
    }
    set.add(res);

    req.on('close', () => {
      set?.delete(res);
      if (set && set.size === 0) {
        jobSubscribers.delete(jobId);
      }
    });
  });

  // Saved Projects / Cache Library
  app.get('/api/projects', async (_req, res) => {
    const projects = await listProjects();
    // Return lightweight list summaries + full cue count
    const summaries = projects.map((p) => ({
      id: p.id,
      cacheKey: p.cacheKey,
      title: p.title,
      movieId: p.movieId,
      posterUrl: p.posterUrl,
      releaseYear: p.releaseYear,
      mediaType: p.mediaType,
      baseLang: p.baseLang,
      targetLang: p.targetLang,
      mode: p.mode,
      phoneticStyle: p.phoneticStyle,
      sourceFileName: p.sourceFileName,
      sourceFormat: p.sourceFormat,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      cueCount: p.cues.length,
    }));
    res.json({ projects: summaries });
  });

  app.get('/api/projects/:id', async (req, res) => {
    const project = await getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }
    if (!Array.isArray(project.cues) || project.cues.length === 0) {
      return res.status(422).json({ error: 'Project subtitle data is incomplete or invalid.' });
    }
    res.json({ project });
  });

  app.patch('/api/projects/:id', async (req, res) => {
    const { cues, styleConfig, title } = (req.body || {}) as {
      cues?: TriLineCue[];
      styleConfig?: AssStyleConfig;
      title?: string;
    };
    if (cues !== undefined) {
      const validCues =
        Array.isArray(cues) &&
        cues.length > 0 &&
        cues.every(
          (c) =>
            Boolean(c) &&
            typeof c === 'object' &&
            typeof c.startMs === 'number' &&
            Number.isFinite(c.startMs) &&
            typeof c.endMs === 'number' &&
            Number.isFinite(c.endMs) &&
            c.endMs >= c.startMs &&
            typeof c.baseText === 'string' &&
            typeof c.targetText === 'string' &&
            typeof c.phoneticText === 'string',
        );
      if (!validCues) {
        return res.status(400).json({ error: 'Invalid or incomplete subtitle cues payload.' });
      }
    }
    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: 'Project title must be a non-empty string.' });
    }
    const updated = await updateProject(req.params.id, {
      cues,
      styleConfig,
      title: title?.trim(),
    });
    if (!updated) {
      return res.status(404).json({ error: 'Project not found.' });
    }
    res.json({ project: updated });
  });

  app.delete('/api/projects/:id', async (req, res) => {
    const deleted = await deleteProject(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Project not found.' });
    }
    res.json({ deleted: true });
  });

  function isValidExportCues(cues: unknown): cues is TriLineCue[] {
    return (
      Array.isArray(cues) &&
      cues.length > 0 &&
      cues.every(
        (c) =>
          Boolean(c) &&
          typeof c === 'object' &&
          typeof (c as TriLineCue).startMs === 'number' &&
          Number.isFinite((c as TriLineCue).startMs) &&
          typeof (c as TriLineCue).endMs === 'number' &&
          Number.isFinite((c as TriLineCue).endMs) &&
          (c as TriLineCue).endMs >= (c as TriLineCue).startMs,
      )
    );
  }

  // Server-side formatted SRT, VTT and ASS export
  app.post('/api/export/srt', (req, res) => {
    const { cues, styleConfig, fileName } = (req.body || {}) as {
      cues?: TriLineCue[];
      styleConfig?: AssStyleConfig;
      fileName?: string;
    };
    if (!isValidExportCues(cues)) {
      return res.status(400).json({ error: 'Valid cues with timestamps are required for export.' });
    }
    const content = generateSrtContent(cues, {
      ...DEFAULT_STYLE_CONFIG,
      ...(styleConfig || {}),
    });
    const safeName = (fileName || 'triline_subtitles').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.triline.srt"`);
    res.send(content);
  });

  app.post('/api/export/ass', (req, res) => {
    const { cues, styleConfig, fileName, title } = (req.body || {}) as {
      cues?: TriLineCue[];
      styleConfig?: AssStyleConfig;
      fileName?: string;
      title?: string;
    };
    if (!isValidExportCues(cues)) {
      return res.status(400).json({ error: 'Valid cues with timestamps are required for export.' });
    }
    const content = generateAssContent(
      cues,
      { ...DEFAULT_STYLE_CONFIG, ...(styleConfig || {}) },
      title || 'TriLine Studio Export',
    );
    const safeName = (fileName || 'triline_subtitles').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.triline.ass"`);
    res.send(content);
  });

  app.post('/api/export/vtt', (req, res) => {
    const { cues, styleConfig, fileName } = (req.body || {}) as {
      cues?: TriLineCue[];
      styleConfig?: AssStyleConfig;
      fileName?: string;
    };
    if (!isValidExportCues(cues)) {
      return res.status(400).json({ error: 'Valid cues with timestamps are required for export.' });
    }
    const content = generateVttContent(cues, {
      ...DEFAULT_STYLE_CONFIG,
      ...(styleConfig || {}),
    });
    const safeName = (fileName || 'triline_subtitles').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.triline.vtt"`);
    res.send(content);
  });

  // Ensure API upload/JSON errors always return JSON instead of HTML error pages
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!req.path.startsWith('/api')) {
        return next(err);
      }
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      if (err instanceof SyntaxError) {
        return res.status(400).json({ error: 'Invalid JSON request payload.' });
      }
      const message = err instanceof Error ? err.message : 'Internal server error.';
      return res.status(500).json({ error: message });
    },
  );

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TriLine Studio server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
