import { useState } from 'react';
import { AlertCircle, Download, Film, Search } from 'lucide-react';
import type {
  IntegrationsStatus,
  MovieMetadata,
  ParsedSubtitleResult,
  ProcessingOptions,
  ProviderSubtitleItem,
  TmdbSearchItem,
} from '../types/subtitle';
import { SUPPORTED_LANGUAGES } from '../types/subtitle';

interface MovieSearchViewProps {
  integrations: IntegrationsStatus;
  processingOptions: ProcessingOptions;
  onImportSubtitle: (params: {
    parsed: ParsedSubtitleResult;
    rawBase64?: string;
    slot: 'primary' | 'secondary';
    movieMetadata?: MovieMetadata;
  }) => void;
  onGoToUpload: () => void;
}

export function MovieSearchView({
  integrations,
  processingOptions,
  onImportSubtitle,
  onGoToUpload,
}: MovieSearchViewProps) {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [tmdbResults, setTmdbResults] = useState<TmdbSearchItem[]>([]);
  const [tmdbMessage, setTmdbMessage] = useState<string | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<TmdbSearchItem | null>(null);

  const [subLang, setSubLang] = useState('de');
  const [subResults, setSubResults] = useState<ProviderSubtitleItem[]>([]);
  const [subMessage, setSubMessage] = useState<string | null>(null);
  const [isSearchingSubs, setIsSearchingSubs] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSearchMovies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setErrorMsg(null);
    setTmdbMessage(null);
    try {
      const res = await fetch(`/api/tmdb/search?query=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'TMDB search failed');
      setTmdbResults(data.results || []);
      if (!data.configured && data.message) {
        setTmdbMessage(data.message);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchSubtitles = async (movie?: TmdbSearchItem) => {
    const targetMovie = movie || selectedMovie;
    if (movie) setSelectedMovie(movie);

    setIsSearchingSubs(true);
    setErrorMsg(null);
    setSubMessage(null);
    try {
      const qs = new URLSearchParams();
      if (targetMovie) {
        qs.set('tmdbId', String(targetMovie.id));
        qs.set('query', targetMovie.title);
      } else if (query.trim()) {
        qs.set('query', query.trim());
      }
      if (subLang) qs.set('language', subLang);

      const res = await fetch(`/api/subtitles/provider-search?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Subtitle provider search failed');

      const combined: ProviderSubtitleItem[] = [
        ...(data.opensubtitles?.results || []),
        ...(data.subdl?.results || []),
      ];
      setSubResults(combined);

      const notes: string[] = [];
      if (data.opensubtitles && !data.opensubtitles.configured) {
        notes.push('OpenSubtitles API key not configured');
      }
      if (data.subdl && !data.subdl.configured) {
        notes.push('Subdl API key not configured');
      }
      if (notes.length > 0 && combined.length === 0) {
        setSubMessage(
          `${notes.join(' and ')} in Settings > Secrets. You can still upload SRT, VTT, or ASS files manually in the Generator.`,
        );
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to search subtitles.');
    } finally {
      setIsSearchingSubs(false);
    }
  };

  const handleFetchSubtitle = async (
    item: ProviderSubtitleItem,
    slot: 'primary' | 'secondary',
  ) => {
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

  return (
    <div className="space-y-6">
      {/* Provider Configuration Banner (Honest Status) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Movie & Subtitle Catalog Search
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Look up films and TV series via TMDB and fetch synchronized tracks from OpenSubtitles or Subdl.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
            <span>TMDB: {integrations.tmdb ? 'Connected' : 'Not configured'}</span>
            <span aria-hidden="true">·</span>
            <span>
              OpenSubtitles: {integrations.opensubtitles ? 'Connected' : 'Not configured'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Subdl: {integrations.subdl ? 'Connected' : 'Not configured'}</span>
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

      {/* Search Form */}
      <form
        onSubmit={handleSearchMovies}
        className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3"
      >
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

        <select
          value={subLang}
          onChange={(e) => setSubLang(e.target.value)}
          aria-label="Subtitle search language"
          className="px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.code})
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={isSearching || !query.trim()}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isSearching ? 'Searching...' : 'Search TMDB'}
        </button>

        <button
          type="button"
          disabled={isSearchingSubs || !query.trim()}
          onClick={() => handleSearchSubtitles()}
          className="px-4 py-2.5 text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isSearchingSubs ? 'Querying...' : 'Search Subtitles Directly'}
        </button>
      </form>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex items-start gap-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {tmdbMessage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
          {tmdbMessage}
        </div>
      )}

      {/* TMDB Results */}
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
                      onClick={() => handleSearchSubtitles(item)}
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

      {subMessage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
          {subMessage}
        </div>
      )}

      {/* Provider Subtitle Matches */}
      {subResults.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Available Subtitles {selectedMovie ? `for ${selectedMovie.title}` : ''}
            </h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {subResults.length} releases
            </span>
          </div>
          <div className="divide-y divide-slate-200">
            {subResults.map((sub) => (
              <div
                key={sub.id}
                className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {sub.release}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {sub.provider === 'opensubtitles' ? 'OpenSubtitles' : 'Subdl'} ·{' '}
                    {sub.language.toUpperCase()} · {sub.fileName}
                    {sub.hearingImpaired ? ' · SDH' : ''}
                    {typeof sub.downloadCount === 'number'
                      ? ` · ${sub.downloadCount.toLocaleString()} downloads`
                      : ''}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={downloadingId === sub.id}
                    onClick={() => handleFetchSubtitle(sub, 'primary')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {downloadingId === sub.id ? 'Loading...' : 'Load as Primary'}
                  </button>
                  <button
                    type="button"
                    disabled={downloadingId === sub.id}
                    onClick={() => handleFetchSubtitle(sub, 'secondary')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    Load as Secondary
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
