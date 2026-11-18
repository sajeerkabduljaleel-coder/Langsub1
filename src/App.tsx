import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Layers,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  DEFAULT_LEARNING_CONTROLS,
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_STYLE_CONFIG,
  SUPPORTED_LANGUAGES,
  type AlignedCuePair,
  type AlignmentPreviewData,
  type AssStyleConfig,
  type ConversionJob,
  type ConversionMode,
  type IntegrationProviderId,
  type IntegrationsStatus,
  type LearningControlsConfig,
  type MovieMetadata,
  type ParsedSubtitleResult,
  type PhoneticStyle,
  type ProcessingOptions,
  type ProviderDiagnostic,
  type SavedProject,
  type TranslationStyle,
  type TriLineCue,
} from './types/subtitle';
import { SAMPLE_DATASETS, type SampleDataset } from './data/samples';
import { AlignmentInspector } from './components/AlignmentInspector';
import { CinemaPreview } from './components/CinemaPreview';
import { CueEditorTable } from './components/CueEditorTable';
import { StyleExportPanel } from './components/StyleExportPanel';
import { MovieSearchView } from './components/MovieSearchView';
import { LibraryView, type ProjectSummary } from './components/LibraryView';
import { SettingsView } from './components/SettingsView';

type ActiveTab = 'generator' | 'search' | 'library' | 'export' | 'settings';

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('generator');

  // Integrations & Library Cache State
  const [integrations, setIntegrations] = useState<IntegrationsStatus>({
    gemini: true,
    tmdb: false,
    opensubtitles: false,
    subdl: false,
  });
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostic[]>([]);
  const [testingProviders, setTestingProviders] = useState<Record<string, boolean>>({});
  const [cachedLineCount, setCachedLineCount] = useState(0);
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);

  // Conversion Configuration
  const [mode, setMode] = useState<ConversionMode>('target-first');
  const [baseLang, setBaseLang] = useState('English');
  const [targetLang, setTargetLang] = useState('German');
  const [phoneticStyle, setPhoneticStyle] = useState<PhoneticStyle>('hyphenated');
  const [translationStyle, setTranslationStyle] = useState<TranslationStyle>('natural');
  const [learningControls, setLearningControls] = useState<LearningControlsConfig>(
    DEFAULT_LEARNING_CONTROLS,
  );
  const [processingOptions, setProcessingOptions] = useState<ProcessingOptions>(
    DEFAULT_PROCESSING_OPTIONS,
  );

  // Source Subtitle Tracks
  const [primaryParsed, setPrimaryParsed] = useState<ParsedSubtitleResult | null>(null);
  const [primaryRawBase64, setPrimaryRawBase64] = useState<string | null>(null);
  const [secondaryParsed, setSecondaryParsed] = useState<ParsedSubtitleResult | null>(null);
  const [secondaryRawBase64, setSecondaryRawBase64] = useState<string | null>(null);
  const [movieMetadata, setMovieMetadata] = useState<MovieMetadata | undefined>(undefined);
  const [alignmentPreview, setAlignmentPreview] = useState<AlignmentPreviewData | null>(null);
  const [hasAlignmentEdits, setHasAlignmentEdits] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  // Active Conversion Job & Output Workspace
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [cues, setCues] = useState<TriLineCue[]>([]);
  const [styleConfig, setStyleConfig] = useState<AssStyleConfig>(DEFAULT_STYLE_CONFIG);
  const [activeCueIndex, setActiveCueIndex] = useState(0);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const fetchIntegrationsAndLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    try {
      const [statusRes, projRes] = await Promise.all([
        fetch('/api/integrations/status'),
        fetch('/api/projects'),
      ]);
      if (statusRes.ok) {
        const sData = await statusRes.json();
        setIntegrations(sData.status);
        setDiagnostics(sData.diagnostics || []);
        setCachedLineCount(sData.cacheStats?.cachedLineCount || 0);
      }
      if (projRes.ok) {
        const pData = await projRes.json();
        setSavedProjects(pData.projects || []);
      }
    } catch {
      // Keep non-fatal
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    void fetchIntegrationsAndLibrary();
  }, [fetchIntegrationsAndLibrary]);

  const handleTestConnection = async (provider: IntegrationProviderId | 'all') => {
    setTestingProviders((prev) => ({ ...prev, [provider]: true }));
    setErrorMsg(null);
    try {
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Connection test failed.');
      if (data.status) setIntegrations(data.status);
      if (data.diagnostics) setDiagnostics(data.diagnostics);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Integration test failed.');
    } finally {
      setTestingProviders((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const parseFileSlot = async (
    fileOrPayload: File | { rawText: string; fileName: string } | { rawBase64: string; fileName: string },
    slot: 'primary' | 'secondary',
    opts: ProcessingOptions = processingOptions,
  ) => {
    setIsParsing(true);
    setErrorMsg(null);
    setAlignmentPreview(null);
    setHasAlignmentEdits(false);
    try {
      let res: Response;
      if (fileOrPayload instanceof File) {
        const form = new FormData();
        form.append('file', fileOrPayload);
        form.append('options', JSON.stringify(opts));
        res = await fetch('/api/subtitles/parse', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/subtitles/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...fileOrPayload,
            options: opts,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse subtitle file.');

      if (slot === 'primary') {
        setPrimaryParsed(data.parsed);
        setPrimaryRawBase64(data.rawBase64);
      } else {
        setSecondaryParsed(data.parsed);
        setSecondaryRawBase64(data.rawBase64);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Subtitle parsing error.');
    } finally {
      setIsParsing(false);
    }
  };

  // Re-parse automatically if cleaning options change and we already have raw buffer
  const handleToggleOption = async (key: keyof ProcessingOptions, value: boolean) => {
    const nextOpts = { ...processingOptions, [key]: value };
    setProcessingOptions(nextOpts);

    if (primaryRawBase64 && primaryParsed) {
      await parseFileSlot(
        { rawBase64: primaryRawBase64, fileName: primaryParsed.fileName },
        'primary',
        nextOpts,
      );
    }
    if (secondaryRawBase64 && secondaryParsed) {
      await parseFileSlot(
        { rawBase64: secondaryRawBase64, fileName: secondaryParsed.fileName },
        'secondary',
        nextOpts,
      );
    }
  };

  const handleLoadSample = async (sample: SampleDataset) => {
    setMode(sample.mode);
    setBaseLang(sample.baseLang);
    setTargetLang(sample.targetLang);
    setMovieMetadata({ title: sample.title });
    setStatusNotice(null);

    await parseFileSlot(
      { rawText: sample.primaryContent, fileName: sample.primaryFileName },
      'primary',
    );
    if (sample.secondaryContent && sample.secondaryFileName) {
      await parseFileSlot(
        { rawText: sample.secondaryContent, fileName: sample.secondaryFileName },
        'secondary',
      );
    } else {
      setSecondaryParsed(null);
      setSecondaryRawBase64(null);
    }
  };

  const handlePreviewAlignment = async () => {
    if (!primaryParsed || !secondaryParsed) return;
    setErrorMsg(null);
    try {
      const targetTrack = mode === 'base-first' ? secondaryParsed : primaryParsed;
      const baseTrack = mode === 'base-first' ? primaryParsed : secondaryParsed;
      const res = await fetch('/api/subtitles/align-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetParsed: targetTrack, baseParsed: baseTrack }),
      });
      const data = (await res.json()) as AlignmentPreviewData & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Alignment check failed.');
      setAlignmentPreview({
        aligned: data.aligned,
        unmatchedBaseCues: data.unmatchedBaseCues,
        stats: data.stats,
      });
      setHasAlignmentEdits(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Alignment check failed.');
    }
  };

  const handleUpdateAlignedPairs = (nextAligned: AlignedCuePair[]) => {
    setAlignmentPreview((prev) => {
      if (!prev) return prev;
      const exactMatches = nextAligned.filter((a) => a.relationship === 'exact').length;
      const interpolatedMatches = nextAligned.filter(
        (a) => a.relationship === 'interpolated',
      ).length;
      const oneToManyMatches = nextAligned.filter((a) => a.relationship === 'one-to-many').length;
      const manyToOneMatches = nextAligned.filter((a) => a.relationship === 'many-to-one').length;
      const unmatchedTarget = nextAligned.filter(
        (a) => a.relationship === 'unmatched-target',
      ).length;
      const unmatchedBase = nextAligned.filter((a) => a.relationship === 'unmatched-base').length;
      const uncertainCount = nextAligned.filter((a) => a.uncertain).length;
      const averageConfidence =
        nextAligned.length > 0
          ? Number(
              (nextAligned.reduce((s, a) => s + a.confidence, 0) / nextAligned.length).toFixed(2),
            )
          : 0;
      return {
        ...prev,
        aligned: nextAligned,
        stats: {
          ...prev.stats,
          exactMatches,
          interpolatedMatches,
          oneToManyMatches,
          manyToOneMatches,
          unmatchedTarget,
          unmatchedBase,
          uncertainCount,
          averageConfidence,
        },
      };
    });
    setHasAlignmentEdits(true);
  };

  const loadProjectById = async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { project: SavedProject };
    const p = data.project;
    setActiveProjectId(p.id);
    setCues(p.cues);
    setStyleConfig(p.styleConfig || DEFAULT_STYLE_CONFIG);
    setActiveCueIndex(0);
    setHasUnsavedEdits(false);
    setMode(p.mode);
    setBaseLang(p.baseLang);
    setTargetLang(p.targetLang);
    setPhoneticStyle(p.phoneticStyle);
    setTranslationStyle(p.translationStyle || 'natural');
    setMovieMetadata({
      movieId: p.movieId,
      title: p.title,
      posterUrl: p.posterUrl,
      releaseYear: p.releaseYear,
      mediaType: p.mediaType,
    });
  };

  const handleStartConversion = async (forceRegenerate = false) => {
    if (!primaryParsed) {
      setErrorMsg('Please upload a subtitle file or load a sample dataset first.');
      return;
    }
    if (mode === 'dual-merge' && !secondaryParsed) {
      setErrorMsg('Dual-File Merge requires both Target and Base subtitle files.');
      return;
    }

    setErrorMsg(null);
    setStatusNotice(null);

    const handleJobTerminalState = async (finalJob: ConversionJob) => {
      if (finalJob.status === 'completed') {
        if (finalJob.projectId) {
          await loadProjectById(finalJob.projectId);
        }
        setStatusNotice(
          `Generated ${finalJob.totalCues} three-line cues (${finalJob.cacheHits} served from line cache).`,
        );
        void fetchIntegrationsAndLibrary();
      } else if (finalJob.status === 'failed') {
        setErrorMsg(finalJob.error || 'Subtitle conversion failed.');
      }
    };

    const pollJobUntilDone = async (jobId: string) => {
      for (let attempt = 0; attempt < 180; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const pollRes = await fetch(`/api/jobs/${jobId}`);
          if (!pollRes.ok) {
            setErrorMsg('Conversion job status could not be retrieved.');
            setActiveJob((prev) =>
              prev && prev.jobId === jobId ? { ...prev, status: 'failed' } : prev,
            );
            return;
          }
          const pollData = (await pollRes.json()) as { job: ConversionJob };
          setActiveJob(pollData.job);
          if (pollData.job.status === 'completed' || pollData.job.status === 'failed') {
            await handleJobTerminalState(pollData.job);
            return;
          }
        } catch {
          // Transient network error; continue polling
        }
      }
      setErrorMsg('Conversion job timed out while polling for completion.');
    };

    try {
      const res = await fetch('/api/jobs/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          baseLang,
          targetLang,
          phoneticStyle,
          translationStyle,
          processingOptions,
          styleConfig,
          primaryParsed,
          secondaryParsed: secondaryParsed || undefined,
          alignedPairs: hasAlignmentEdits && alignmentPreview ? alignmentPreview.aligned : undefined,
          alignmentStats:
            hasAlignmentEdits && alignmentPreview ? alignmentPreview.stats : undefined,
          movieMetadata,
          forceRegenerate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start conversion job.');

      const job: ConversionJob = data.job;
      setActiveJob(job);

      // Immediate project cache hit
      if (job.status === 'completed' && data.cachedProject) {
        const cached = data.cachedProject as SavedProject;
        setActiveProjectId(cached.id);
        setCues(cached.cues);
        setStyleConfig(cached.styleConfig || DEFAULT_STYLE_CONFIG);
        setActiveCueIndex(0);
        setHasUnsavedEdits(false);
        setStatusNotice(
          `Loaded ${cached.cues.length} synchronized three-line cues instantly from project cache.`,
        );
        void fetchIntegrationsAndLibrary();
        return;
      }

      // Stream live batch progress via SSE with polling fallback on disconnect
      const evtSource = new EventSource(`/api/jobs/${job.jobId}/stream`);
      let finished = false;
      evtSource.onmessage = async (event) => {
        const updated = JSON.parse(event.data) as ConversionJob;
        setActiveJob(updated);

        if (updated.status === 'completed' || updated.status === 'failed') {
          finished = true;
          evtSource.close();
          await handleJobTerminalState(updated);
        }
      };
      evtSource.onerror = () => {
        evtSource.close();
        if (!finished) {
          void pollJobUntilDone(job.jobId);
        }
      };
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Conversion failed.');
    }
  };

  const handleUpdateCue = (idx: number, patch: Partial<TriLineCue>) => {
    setCues((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    setHasUnsavedEdits(true);
  };

  const handleSaveEdits = async () => {
    if (!activeProjectId) return;
    setIsSavingEdits(true);
    try {
      const res = await fetch(`/api/projects/${activeProjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cues, styleConfig }),
      });
      if (!res.ok) throw new Error('Failed to save edits.');
      setHasUnsavedEdits(false);
      setStatusNotice('Saved subtitle edits and ASS styling to project library.');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setIsSavingEdits(false);
    }
  };

  const handleExport = async (
    format: 'srt' | 'ass' | 'vtt',
    targetCues: TriLineCue[] = cues,
    targetStyle: AssStyleConfig = styleConfig,
    fileBaseName?: string,
  ) => {
    if (targetCues.length === 0) return;
    setIsExporting(true);
    setErrorMsg(null);
    try {
      const baseTitle =
        fileBaseName ||
        movieMetadata?.title ||
        primaryParsed?.fileName.replace(/\.(srt|vtt|ass|ssa)$/i, '') ||
        'triline_subtitles';

      const res = await fetch(`/api/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cues: targetCues,
          styleConfig: targetStyle,
          fileName: baseTitle,
          title: movieMetadata?.title || baseTitle,
        }),
      });
      if (!res.ok) throw new Error(`Failed to export ${format.toUpperCase()} file.`);
      const blob = await res.blob();
      triggerBlobDownload(blob, `${baseTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}.triline.${format}`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportProjectFromLibrary = async (id: string, format: 'srt' | 'ass' | 'vtt') => {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { project: SavedProject };
    await handleExport(format, data.project.cues, data.project.styleConfig, data.project.title);
  };

  const handleDeleteProject = async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setSavedProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProjectId === id) {
        setActiveProjectId(null);
      }
    }
  };

  const isJobRunning = activeJob?.status === 'processing' || activeJob?.status === 'queued';
  const progressPercent =
    activeJob && activeJob.totalCues > 0
      ? Math.round((activeJob.processedCues / activeJob.totalCues) * 100)
      : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('generator')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            TriLine Studio
          </button>

          {/* Zone 2: concise single-line text nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {(
              [
                { id: 'generator', label: 'Generator' },
                { id: 'search', label: 'Movie Search' },
                { id: 'library', label: 'Saved Library' },
                { id: 'export', label: 'Export & Style' },
                { id: 'settings', label: 'Settings' },
              ] as Array<{ id: ActiveTab; label: string }>
            ).map((nav) => (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveTab(nav.id)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === nav.id
                    ? 'border-blue-600 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {nav.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 primary CTA */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                if (cues.length > 0) {
                  void handleExport('ass');
                } else {
                  setActiveTab('generator');
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              {cues.length > 0 ? 'Download ASS' : 'Start Subtitle'}
            </button>
          </div>
        </div>

        {/* Mobile Secondary Tab Bar */}
        <div className="md:hidden border-t border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
          {(
            [
              { id: 'generator', label: 'Generator' },
              { id: 'search', label: 'Movie Search' },
              { id: 'library', label: 'Library' },
              { id: 'export', label: 'Export & Style' },
              { id: 'settings', label: 'Settings' },
            ] as Array<{ id: ActiveTab; label: string }>
          ).map((nav) => (
            <button
              key={nav.id}
              type="button"
              onClick={() => setActiveTab(nav.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                activeTab === nav.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 bg-slate-100'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
        {errorMsg && activeTab !== 'search' && (
          <div className="mb-5 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 flex items-start justify-between gap-3 text-sm">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-xs font-semibold text-red-700 hover:underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {statusNotice && activeTab === 'generator' && (
          <div className="mb-5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-xs font-semibold text-emerald-800 hover:underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === 'generator' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left Column: Acquisition, Mode & Processing Pipeline (4 cols on xl) */}
            <div className="xl:col-span-5 space-y-5">
              {/* Step 1: Conversion Mode & Languages */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">
                    Three-Line Subtitle Generator
                  </h1>
                  <p className="text-sm text-slate-600 mt-1">
                    Produce synchronized Base translation, Target dialogue, and English-intuitive phonetics.
                  </p>
                </div>

                {/* Mode Segmented Control */}
                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-2">
                    Conversion Mode
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                    {(
                      [
                        { id: 'target-first', label: 'Target-First' },
                        { id: 'base-first', label: 'Base-First' },
                        { id: 'dual-merge', label: 'Dual Merge' },
                      ] as Array<{ id: ConversionMode; label: string }>
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setMode(m.id);
                          setAlignmentPreview(null);
                          setHasAlignmentEdits(false);
                        }}
                        className={`px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          mode === m.id
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {mode === 'target-first' &&
                      'Upload a foreign-language subtitle; AI generates English translation and intuitive phonetics.'}
                    {mode === 'base-first' &&
                      'Upload an English subtitle (plus optional target file); AI translates into natural dialogue and generates phonetics.'}
                    {mode === 'dual-merge' &&
                      'Upload both target and base subtitle files; intelligent aligner pairs cues and generates phonetics.'}
                  </p>
                </div>

                {/* Language Pair + Translation Style + Phonetic Convention */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Base Language</span>
                    <select
                      value={baseLang}
                      onChange={(e) => setBaseLang(e.target.value)}
                      className="mt-1 w-full px-2.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                    >
                      {SUPPORTED_LANGUAGES.map((l) => (
                        <option key={l.code} value={l.name}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Target Language</span>
                    <select
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      className="mt-1 w-full px-2.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                    >
                      {SUPPORTED_LANGUAGES.filter((l) => l.name !== baseLang).map((l) => (
                        <option key={l.code} value={l.name}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Translation Style</span>
                    <select
                      value={translationStyle}
                      onChange={(e) =>
                        setTranslationStyle(e.target.value as TranslationStyle)
                      }
                      className="mt-1 w-full px-2.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                    >
                      <option value="natural">Natural Dialogue</option>
                      <option value="literal">Close / Literal</option>
                      <option value="colloquial">Colloquial / Spoken</option>
                      <option value="formal">Formal Register</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">Phonetic Style</span>
                    <select
                      value={phoneticStyle}
                      onChange={(e) => setPhoneticStyle(e.target.value as PhoneticStyle)}
                      className="mt-1 w-full px-2.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                    >
                      <option value="hyphenated">Syllable Stress</option>
                      <option value="flowing">Natural Flow</option>
                      <option value="standard">Standard Romanization</option>
                    </select>
                  </label>
                </div>
              </section>

              {/* Step 2: Subtitle Acquisition (Upload + Samples) */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">
                    Subtitle Acquisition
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('search')}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                  >
                    Search TMDB / Providers
                  </button>
                </div>

                {/* Primary Upload Slot */}
                <div className="space-y-3">
                  <label className="block border border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-4 bg-slate-50/70 transition-colors cursor-pointer">
                    <input
                      type="file"
                      accept=".srt,.vtt,.ass,.ssa"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void parseFileSlot(file, 'primary');
                        e.target.value = '';
                      }}
                    />
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <Upload className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {primaryParsed
                            ? primaryParsed.fileName
                            : mode === 'base-first'
                              ? `Upload ${baseLang} Subtitle (.srt, .vtt, .ass)`
                              : `Upload ${targetLang} Subtitle (.srt, .vtt, .ass)`}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {primaryParsed
                            ? `${primaryParsed.report.finalCueCount} cues · ${primaryParsed.report.detectedEncoding} · ${primaryParsed.report.originalFormat.toUpperCase()}`
                            : 'Auto-detects UTF-8, UTF-16, Windows-1252, Shift_JIS & repairs Unicode'}
                        </div>
                      </div>
                    </div>
                  </label>

                  {/* Secondary Slot for Dual-Merge or Base-First Optional Target */}
                  {(mode === 'dual-merge' || mode === 'base-first') && (
                    <label className="block border border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-4 bg-slate-50/70 transition-colors cursor-pointer">
                      <input
                        type="file"
                        accept=".srt,.vtt,.ass,.ssa"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void parseFileSlot(file, 'secondary');
                          e.target.value = '';
                        }}
                      />
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {secondaryParsed
                              ? secondaryParsed.fileName
                              : mode === 'dual-merge'
                                ? `Upload ${baseLang} Reference Subtitle (.srt, .vtt, .ass)`
                                : `Optional: Upload Matched ${targetLang} Subtitle`}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                            {secondaryParsed
                              ? `${secondaryParsed.report.finalCueCount} cues · ${secondaryParsed.report.detectedEncoding}`
                              : 'Supports intelligent timestamp + offset alignment'}
                          </div>
                        </div>
                      </div>
                    </label>
                  )}
                </div>

                {/* Quick Sample Loaders */}
                <div className="pt-2 border-t border-slate-200">
                  <span className="block text-xs font-medium text-slate-500 mb-2">
                    Or load an authentic test subtitle:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {SAMPLE_DATASETS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={isParsing}
                        onClick={() => void handleLoadSample(s)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        {s.targetLang} ({s.mode === 'target-first' ? 'SRT' : s.mode === 'dual-merge' ? 'Dual' : 'VTT'})
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* Step 3: Cleaning Options & Execution */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Processing & Generation
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={processingOptions.removeSdh}
                      onChange={(e) => void handleToggleOption('removeSdh', e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Strip SDH & sound cues</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={processingOptions.mergeMultiline}
                      onChange={(e) =>
                        void handleToggleOption('mergeMultiline', e.target.checked)
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Merge multi-line dialogue</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={processingOptions.removeDuplicates}
                      onChange={(e) =>
                        void handleToggleOption('removeDuplicates', e.target.checked)
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Deduplicate adjacent lines</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={processingOptions.preserveFormattingTags}
                      onChange={(e) =>
                        void handleToggleOption('preserveFormattingTags', e.target.checked)
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Keep inline &lt;i&gt; tags</span>
                  </label>
                </div>

                {/* Parsed Diagnostics Report */}
                {primaryParsed && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5 tabular-nums">
                    <div className="font-semibold text-slate-800">
                      Parsed Track Diagnostics
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span>Encoding: {primaryParsed.report.detectedEncoding}</span>
                      <span>·</span>
                      <span>Input Cues: {primaryParsed.report.totalInputCues}</span>
                      <span>·</span>
                      <span>SDH Cleaned: {primaryParsed.report.sdhStrippedCount}</span>
                      <span>·</span>
                      <span>Merged Lines: {primaryParsed.report.mergedLineCount}</span>
                      <span>·</span>
                      <span>Output Cues: {primaryParsed.report.finalCueCount}</span>
                      {(primaryParsed.report.overlappingCueCount ?? 0) > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-amber-700 font-medium">
                            Overlapping Cues: {primaryParsed.report.overlappingCueCount}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Dual-File Alignment Check */}
                {(mode === 'dual-merge' || (mode === 'base-first' && secondaryParsed)) &&
                  primaryParsed &&
                  secondaryParsed && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => void handlePreviewAlignment()}
                        className="w-full px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        Check Dual-Track Timestamp Alignment
                      </button>

                      {alignmentPreview && (
                        <AlignmentInspector
                          preview={alignmentPreview}
                          hasManualEdits={hasAlignmentEdits}
                          onChangeAligned={handleUpdateAlignedPairs}
                          onResetAlignment={() => void handlePreviewAlignment()}
                        />
                      )}
                    </div>
                  )}

                {/* Progress Bar when Job is Active */}
                {activeJob && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-800 tabular-nums">
                      <span>
                        {activeJob.status === 'completed'
                          ? 'Conversion Complete'
                          : activeJob.status === 'failed'
                            ? 'Conversion Failed'
                            : `Processing Batch ${activeJob.apiBatchesCompleted}/${Math.max(1, activeJob.apiBatchesTotal)}...`}
                      </span>
                      <span>
                        {activeJob.processedCues}/{activeJob.totalCues} cues ({progressPercent}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          activeJob.status === 'failed'
                            ? 'bg-red-600'
                            : activeJob.status === 'completed'
                              ? 'bg-emerald-600'
                              : 'bg-blue-600'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                      <span>Cache hits: {activeJob.cacheHits} lines</span>
                      {isJobRunning && (
                        <span>Est. {activeJob.estimatedRemainingSec}s remaining</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Generate Actions */}
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={!primaryParsed || isJobRunning || isParsing}
                    onClick={() => void handleStartConversion(false)}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    {isJobRunning
                      ? 'Generating Three-Line Subtitles...'
                      : 'Generate Three-Line Subtitles'}
                  </button>

                  {cues.length > 0 && primaryParsed && (
                    <button
                      type="button"
                      disabled={isJobRunning}
                      onClick={() => void handleStartConversion(true)}
                      title="Bypass cache and regenerate all cues"
                      className="p-2.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </section>
            </div>

            {/* Right Column: Live 16:9 Cinema Stage + Cue Editor + Quick Export (7 cols on xl) */}
            <div className="xl:col-span-7 space-y-5">
              <CinemaPreview
                cues={cues}
                styleConfig={styleConfig}
                activeCueIndex={activeCueIndex}
                onSelectCueIndex={setActiveCueIndex}
                title={movieMetadata?.title || primaryParsed?.fileName}
                learningControls={learningControls}
                onChangeLearningControls={setLearningControls}
              />

              {cues.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-600 tabular-nums">
                    <span className="font-semibold text-slate-900">Ready to export</span> ·{' '}
                    {cues.length} cues · {baseLang} (White) / {targetLang} (Yellow) / Phonetics (Cyan)
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('export')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Customize Style
                    </button>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => void handleExport('srt')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      .SRT
                    </button>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => void handleExport('vtt')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      .VTT
                    </button>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => void handleExport('ass')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      .ASS
                    </button>
                  </div>
                </div>
              )}

              <CueEditorTable
                cues={cues}
                styleConfig={styleConfig}
                activeCueIndex={activeCueIndex}
                onSelectCueIndex={setActiveCueIndex}
                onUpdateCue={handleUpdateCue}
                hasUnsavedEdits={hasUnsavedEdits}
                onSaveEdits={() => void handleSaveEdits()}
                isSaving={isSavingEdits}
              />
            </div>
          </div>
        )}

        {activeTab === 'search' && (
          <MovieSearchView
            integrations={integrations}
            diagnostics={diagnostics}
            processingOptions={processingOptions}
            onImportSubtitle={({ parsed, rawBase64, slot, movieMetadata: meta }) => {
              setAlignmentPreview(null);
              setHasAlignmentEdits(false);
              if (slot === 'primary') {
                setPrimaryParsed(parsed);
                setPrimaryRawBase64(rawBase64 || null);
              } else {
                setSecondaryParsed(parsed);
                setSecondaryRawBase64(rawBase64 || null);
              }
              if (meta) setMovieMetadata(meta);
              setStatusNotice(`Imported ${parsed.fileName} (${parsed.report.finalCueCount} cues).`);
              setActiveTab('generator');
            }}
            onGoToUpload={() => setActiveTab('generator')}
            onGoToSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'library' && (
          <LibraryView
            projects={savedProjects}
            cachedLineCount={cachedLineCount}
            isLoading={isLoadingLibrary}
            onOpenProject={async (id) => {
              await loadProjectById(id);
              setActiveTab('generator');
            }}
            onDeleteProject={(id) => void handleDeleteProject(id)}
            onExportProject={(id, fmt) => void handleExportProjectFromLibrary(id, fmt)}
            onGoToGenerator={() => setActiveTab('generator')}
          />
        )}

        {activeTab === 'export' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-6">
              <StyleExportPanel
                styleConfig={styleConfig}
                onChangeStyle={(next) => {
                  setStyleConfig(next);
                  if (activeProjectId) setHasUnsavedEdits(true);
                }}
                cues={cues}
                onDownloadSrt={() => void handleExport('srt')}
                onDownloadVtt={() => void handleExport('vtt')}
                onDownloadAss={() => void handleExport('ass')}
                isExporting={isExporting}
              />
            </div>

            <div className="xl:col-span-6 space-y-4">
              <CinemaPreview
                cues={cues}
                styleConfig={styleConfig}
                activeCueIndex={activeCueIndex}
                onSelectCueIndex={setActiveCueIndex}
                title={movieMetadata?.title || primaryParsed?.fileName}
                learningControls={learningControls}
                onChangeLearningControls={setLearningControls}
              />
              {hasUnsavedEdits && activeProjectId && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isSavingEdits}
                    onClick={() => void handleSaveEdits()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                  >
                    {isSavingEdits ? 'Saving Style...' : 'Save Style to Library Project'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <SettingsView
            diagnostics={diagnostics}
            testingProviders={testingProviders}
            onTestConnection={(provider) => void handleTestConnection(provider)}
            savedProjectCount={savedProjects.length}
            cachedLineCount={cachedLineCount}
          />
        )}
      </main>
    </div>
  );
}
