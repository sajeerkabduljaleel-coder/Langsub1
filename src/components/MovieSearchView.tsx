import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import type {
  IntegrationsStatus,
  MovieMetadata,
  MultiProviderSearchResponse,
  ParsedSubtitleResult,
  ProcessingOptions,
  ProviderDiagnostic,
  ProviderSearchOutcome,
  ProviderSubtitleItem,
  SubtitleProviderId,
  TmdbSearchItem,
} from '../types/subtitle';
import { SUPPORTED_LANGUAGES } from '../types/subtitle';

interface MovieSearchViewProps {
  integrations: IntegrationsStatus;
  diagnostics?: ProviderDiagnostic[];
  processingOptions: ProcessingOptions;
  onImportSubtitle: (params: {
    parsed: ParsedSubtitleResult;
    rawBase64?: string;
    slot: 'primary' | 'secondary';
    movieMetadata?: MovieMetadata;
  }) => void;
  onGoToUpload: () => void;
  onGoToSettings?: () => void;
}

const FORMAT_OPTIONS = [
  { value: 'all', label: 'All Formats' },
  { value: 'srt', label: 'SRT (.srt)' },
  { value: 'vtt', label: 'WebVTT (.vtt)' },
  { value: 'ass', label: 'ASS (.ass)' },
  { value: 'ssa', label: 'SSA (.ssa)' },
] as const;

export function MovieSearchView({
  integrations,
  diagnostics = [],
  processingOptions,
  onImportSubtitle,
  onGoToUpload,
  onGoToSettings,
}: MovieSearchViewProps) {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [tmdbResults, setTmdbResults] = useState<TmdbSearchItem[]>([]);
  const [tmdbMessage, setTmdbMessage] = useState<string | null>(null);
  const [tmdbError, setTmdbError] = useState<string | null>(null);
  const [tmdbHasSearched, setTmdbHasSearched] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<TmdbSearchItem | null>(null);

  const [subLang, setSubLang] = useState('de');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | SubtitleProviderId>('all');

  const [providerOutcomes, setProviderOutcomes] = useState<{
    opensubtitles?: ProviderSearchOutcome;
    subdl?: ProviderSearchOutcome;
  }>({});
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);
  const [loadingProviders, setLoadingProviders] = useState<Record<SubtitleProviderId, boolean>>({
    opensubtitles: false,
    subdl: false,
  });
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const diagMap = useMemo(() => {
    const map = new Map<string, ProviderDiagnostic>();
    for (const d of diagnostics) {
      map.set(d.provider, d);
    }
    return map;
  }, [diagnostics]);

  const formatProviderBadge = (provider: 'tmdb' | 'opensubtitles' | 'subdl', fallbackConfigured: boolean) => {
    const diag = diagMap.get(provider);
    if (!diag) return fallbackConfigured ? 'Configured' : 'Not configured';
    if (!diag.configured) return 'Not configured';
    if (diag.verificationStatus === 'verified') return 'Verified';
    if (diag.verificationStatus === 'failed') return 'Connection issue';
    return 'Configured (untested)';
  };

  const handleSearchMovies = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setErrorMsg(null);
    setTmdbError(null);
    setTmdbMessage(null);
    setTmdbHasSearched(true);
    try {
      const res = await fetch(`/api/tmdb/search?query=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'TMDB search failed.');
      setTmdbResults(data.results || []);
      if (!data.configured && data.message) {
        setTmdbMessage(data.message);
      }
    } catch (err: unknown) {
      setTmdbError(err instanceof Error ? err.message : 'TMDB search failed.');
      setTmdbResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const runProviderSearch = async (params: {
    movie?: TmdbSearchItem | null;
    targetProvider?: 'all' | SubtitleProviderId;
    languageOverride?: string;
  }) => {
    const targetMovie = params.movie !== undefined ? params.movie : selectedMovie;
    if (params.movie) {
      setSelectedMovie(params.movie);
    }

    const scope = params.targetProvider || providerFilter;
    const activeLang = params.languageOverride !== undefined ? params.languageOverride : subLang;
    const queryStr = targetMovie?.title || query.trim();
    if (!queryStr && !targetMovie?.id) return;

    setErrorMsg(null);
    setLoadingProviders((prev) => ({
      opensubtitles: scope === 'all' || scope === 'opensubtitles' ? true : prev.opensubtitles,
      subdl: scope === 'all' || scope === 'subdl' ? true : prev.subdl,
    }));

    try {
      const qs = new URLSearchParams();
      if (targetMovie) {
        qs.set('tmdbId', String(targetMovie.id));
        qs.set('query', targetMovie.title);
      } else if (queryStr) {
        qs.set('query', queryStr);
      }
      if (activeLang && activeLang !== 'all') {
        qs.set('language', activeLang);
      }
      qs.set('provider', scope);

      const res = await fetch(`/api/subtitles/provider-search?${qs.toString()}`);
      const data = (await res.json()) as MultiProviderSearchResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Subtitle provider search failed.');

      setProviderOutcomes((prev) => ({
        ...(scope === 'all' ? {} : prev),
        ...(data.opensubtitles ? { opensubtitles: data.opensubtitles } : {}),
        ...(data.subdl ? { subdl: data.subdl } : {}),
      }));
      if (typeof data.duplicatesRemoved === 'number') {
        setDuplicatesRemoved(data.duplicatesRemoved);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to query subtitle providers.';
      setErrorMsg(message);
    } finally {
      setLoadingProviders((prev) => ({
        opensubtitles: scope === 'all' || scope === 'opensubtitles' ? false : prev.opensubtitles,
        subdl: scope === 'all' || scope === 'subdl' ? false : prev.subdl,
      }));
    }
  };

  const handleFetchSubtitle = async (
    item: ProviderSubtitleItem,
    slot: 'primary' | 'secondary',
  ) => {
    if (!item.downloadable || !item.downloadRef) {
      setErrorMsg('This subtitle release does not expose a downloadable file reference.');
      return;
    }
    setDownloadingId(item.id);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/subtitles/provider-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: item.provider,
          downloadRef: item.downloadRef,
          options: processingOptions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Subtitle download failed.');

      const movieMeta: MovieMetadata | undefined = selectedMovie
        ? {
            movieId: String(selectedMovie.id),
            title: selectedMovie.title,
            releaseYear: selectedMovie.releaseYear,
            posterUrl: selectedMovie.posterUrl || undefined,
            mediaType: selectedMovie.mediaType,
            originalLanguage: selectedMovie.originalLanguage,
          }
        : undefined;

      onImportSubtitle({
        parsed: data.parsed,
        rawBase64: data.rawBase64,
        slot,
        movieMetadata: movieMeta,
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };

  const filterItems = (items: ProviderSubtitleItem[]) => {
    return items.filter((item) => {
      if (subLang !== 'all' && item.language && item.language !== 'unknown') {
        const normLang = item.language.toLowerCase();
        if (normLang !== subLang && !normLang.startsWith(`${subLang}-`)) {
          return false;
        }
      }
      if (formatFilter !== 'all' && item.format.toLowerCase() !== formatFilter) {
        return false;
      }
      return true;
    });
  };

  const visibleProviders: SubtitleProviderId[] =
    providerFilter === 'all' ? ['opensubtitles', 'subdl'] : [providerFilter];

  const hasAnyProviderState = Boolean(
    providerOutcomes.opensubtitles ||
      providerOutcomes.subdl ||
      loadingProviders.opensubtitles ||
      loadingProviders.subdl,
  );

  return (
    <div className="space-y-6">
      {/* Provider Configuration Banner (Honest Status: Configured vs Verified) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Movie &amp; Subtitle Catalog Search
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Look up films and TV series via TMDB and fetch synchronized tracks from OpenSubtitles and SubDL.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-600">
            <span>TMDB: {formatProviderBadge('tmdb', integrations.tmdb)}</span>
            <span aria-hidden="true">·</span>
            <span>
              OpenSubtitles: {formatProviderBadge('opensubtitles', integrations.opensubtitles)}
            </span>
            <span aria-hidden="true">·</span>
            <span>SubDL: {formatProviderBadge('subdl', integrations.subdl)}</span>
            {onGoToSettings && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onGoToSettings}
                  className="text-blue-600 hover:text-blue-700 font-medium hover:underline cursor-pointer"
                >
                  Integration Diagnostics
                </button>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onGoToUpload}
          className="px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Upload Local Subtitle Instead
        </button>
      </div>

      {/* Search & Filter Controls */}
      <form
        onSubmit={handleSearchMovies}
        className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movie or TV series title (e.g., Dark, Parasite, Amélie)..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isSearching ? 'Searching TMDB...' : 'Search TMDB'}
          </button>

          <button
            type="button"
            disabled={
              loadingProviders.opensubtitles ||
              loadingProviders.subdl ||
              (!query.trim() && !selectedMovie)
            }
            onClick={() => void runProviderSearch({ movie: null })}
            className="px-4 py-2.5 text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {loadingProviders.opensubtitles || loadingProviders.subdl
              ? 'Querying Providers...'
              : 'Search Subtitles Directly'}
          </button>
        </div>

        {/* Subtitle Filters */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200 text-xs">
          <label className="flex items-center gap-2 text-slate-700 font-medium">
            <span>Language:</span>
            <select
              value={subLang}
              onChange={(e) => setSubLang(e.target.value)}
              aria-label="Subtitle search language"
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
            >
              <option value="all">All Languages</option>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-slate-700 font-medium">
            <span>Format:</span>
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              aria-label="Subtitle format filter"
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
            >
              {FORMAT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-slate-700 font-medium">
            <span>Provider:</span>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value as 'all' | SubtitleProviderId)}
              aria-label="Subtitle provider filter"
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
            >
              <option value="all">All Providers</option>
              <option value="opensubtitles">OpenSubtitles</option>
              <option value="subdl">SubDL</option>
            </select>
          </label>

          {duplicatesRemoved > 0 && (
            <span className="ml-auto text-slate-500 tabular-nums">
              {duplicatesRemoved} duplicate release{duplicatesRemoved === 1 ? '' : 's'} merged
            </span>
          )}
        </div>
      </form>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex items-start justify-between gap-3 text-sm">
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

      {tmdbError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{tmdbError}</span>
          </div>
          <button
            type="button"
            onClick={() => void handleSearchMovies()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-800 bg-white border border-red-300 rounded-lg hover:bg-red-100 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry TMDB
          </button>
        </div>
      )}

      {tmdbMessage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
          {tmdbMessage}
        </div>
      )}

      {/* TMDB Loading / Empty / Results */}
      {isSearching && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <span>Searching TMDB catalog...</span>
        </div>
      )}

      {!isSearching && tmdbHasSearched && !tmdbError && !tmdbMessage && tmdbResults.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
          No movies or TV series matched &ldquo;{query}&rdquo; on TMDB. You can still search subtitle providers directly by title.
        </div>
      )}

      {tmdbResults.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            Catalog Matches
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {tmdbResults.map((item) => {
              const isSelected = selectedMovie?.id === item.id;
              return (
                <div
                  key={`${item.mediaType}-${item.id}`}
                  className={`bg-white border rounded-xl overflow-hidden flex flex-col ${
                    isSelected ? 'border-blue-600 ring-2 ring-blue-600/20' : 'border-slate-200'
                  }`}
                >
                  <div className="aspect-[2/3] bg-slate-100 relative overflow-hidden">
                    {item.posterUrl ? (
                      <img
                        src={item.posterUrl}
                        alt={`${item.title} poster`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                        <Film className="w-8 h-8 mb-2" />
                        <span className="text-xs font-medium">{item.title}</span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 line-clamp-1">
                        {item.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                        {item.mediaType.toUpperCase()} · {item.releaseYear || 'N/A'} ·{' '}
                        {item.originalLanguage.toUpperCase()} · ★ {item.voteAverage}
                      </p>
                      <p className="text-xs text-slate-600 mt-2 line-clamp-3">
                        {item.overview || 'No synopsis available.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runProviderSearch({ movie: item })}
                      className="w-full px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      Find Subtitles
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Subtitle Results Grouped by Provider */}
      {hasAnyProviderState && (
        <div className="space-y-4">
          {visibleProviders.map((provId) => {
            const label = provId === 'opensubtitles' ? 'OpenSubtitles' : 'SubDL';
            const outcome = providerOutcomes[provId];
            const isLoading = loadingProviders[provId];
            const filtered = outcome ? filterItems(outcome.results) : [];

            return (
              <section
                key={provId}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              >
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm font-semibold text-slate-900">
                      {label}
                      {selectedMovie ? ` · ${selectedMovie.title}` : ''}
                    </h2>
                    {outcome?.ok && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {filtered.length}
                        {filtered.length !== outcome.results.length
                          ? ` of ${outcome.results.length}`
                          : ''}{' '}
                        release{filtered.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={isLoading || (!query.trim() && !selectedMovie)}
                    onClick={() => void runProviderSearch({ targetProvider: provId })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                    Retry {label}
                  </button>
                </div>

                {isLoading ? (
                  <div className="p-6 flex items-center gap-3 text-sm text-slate-600">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Searching {label}...</span>
                  </div>
                ) : !outcome ? (
                  <div className="p-6 text-sm text-slate-500">
                    Ready to search {label}.
                  </div>
                ) : !outcome.configured ? (
                  <div className="p-5 bg-amber-50/70 text-amber-900 text-sm flex flex-wrap items-center justify-between gap-3">
                    <span>
                      {outcome.message || `${label} API key is not configured in server secrets.`}
                    </span>
                    {onGoToSettings && (
                      <button
                        type="button"
                        onClick={onGoToSettings}
                        className="text-xs font-semibold text-amber-900 underline cursor-pointer"
                      >
                        Check Diagnostics
                      </button>
                    )}
                  </div>
                ) : !outcome.ok ? (
                  <div className="p-5 bg-red-50/70 text-red-800 text-sm flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                      <span>{outcome.error || `${label} request failed.`}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runProviderSearch({ targetProvider: provId })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-800 bg-white border border-red-300 rounded-lg hover:bg-red-100 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry {label}
                    </button>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-6 text-sm text-slate-600">
                    {outcome.results.length === 0
                      ? `No subtitles found on ${label} for this query.`
                      : `No ${label} releases match your active language (${subLang.toUpperCase()}) or format (${formatFilter.toUpperCase()}) filter.`}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {filtered.map((sub) => (
                      <div
                        key={sub.id}
                        className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-900 truncate">
                              {sub.release}
                            </span>
                            <span className="px-1.5 py-0.5 text-[11px] font-mono font-semibold uppercase bg-slate-100 text-slate-700 rounded border border-slate-200">
                              {sub.format}
                            </span>
                            {sub.hearingImpaired && (
                              <span className="px-1.5 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-800 rounded border border-amber-200">
                                HI / SDH
                              </span>
                            )}
                            {sub.alsoOnProviders && sub.alsoOnProviders.length > 1 && (
                              <span className="px-1.5 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 rounded border border-blue-200">
                                Also on{' '}
                                {sub.alsoOnProviders
                                  .filter((p) => p !== sub.provider)
                                  .map((p) => (p === 'opensubtitles' ? 'OpenSubtitles' : 'SubDL'))
                                  .join(', ')}
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                            <span className="font-medium text-slate-800">{sub.title}</span>
                            {sub.mediaInfo && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{sub.mediaInfo}</span>
                              </>
                            )}
                            {sub.releaseYear && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{sub.releaseYear}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span>{sub.language.toUpperCase()}</span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-[260px]">{sub.fileName}</span>
                            {typeof sub.downloadCount === 'number' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{sub.downloadCount.toLocaleString()} downloads</span>
                              </>
                            )}
                            {!sub.downloadable && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-red-600 font-medium">Download unavailable</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={downloadingId === sub.id || !sub.downloadable}
                            onClick={() => void handleFetchSubtitle(sub, 'primary')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadingId === sub.id ? 'Loading...' : 'Load as Primary'}
                          </button>
                          <button
                            type="button"
                            disabled={downloadingId === sub.id || !sub.downloadable}
                            onClick={() => void handleFetchSubtitle(sub, 'secondary')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            Load as Secondary
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
