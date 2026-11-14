import { useMemo, useState } from 'react';
import { Download, FolderOpen, Search, Trash2 } from 'lucide-react';
import type { ConversionMode, SubtitleFormat } from '../types/subtitle';

export interface ProjectSummary {
  id: string;
  cacheKey: string;
  title: string;
  movieId?: string;
  posterUrl?: string;
  releaseYear?: string;
  mediaType?: 'movie' | 'tv';
  baseLang: string;
  targetLang: string;
  mode: ConversionMode;
  phoneticStyle: string;
  sourceFileName: string;
  sourceFormat: SubtitleFormat;
  createdAt: string;
  updatedAt: string;
  cueCount: number;
}

interface LibraryViewProps {
  projects: ProjectSummary[];
  cachedLineCount: number;
  isLoading: boolean;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onExportProject: (id: string, format: 'srt' | 'ass') => void;
  onGoToGenerator: () => void;
}

export function LibraryView({
  projects,
  cachedLineCount,
  isLoading,
  onOpenProject,
  onDeleteProject,
  onExportProject,
  onGoToGenerator,
}: LibraryViewProps) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.targetLang.toLowerCase().includes(q) ||
        p.baseLang.toLowerCase().includes(q) ||
        p.sourceFileName.toLowerCase().includes(q),
    );
  }, [projects, filter]);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Saved Subtitles & Translation Cache
          </h1>
          <p className="text-sm text-slate-600 mt-1 tabular-nums">
            {projects.length} saved subtitle projects · {cachedLineCount.toLocaleString()} cached dialogue lines reused across conversions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter saved projects..."
              className="pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 w-60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <button
            type="button"
            onClick={onGoToGenerator}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            New Conversion
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          Loading saved subtitle library...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            {projects.length === 0 ? 'No saved subtitle projects yet' : 'No matching projects'}
          </h2>
          <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
            {projects.length === 0
              ? 'Converted three-line subtitles are automatically cached by source hash, language pair, and processing configuration so you never regenerate the same work twice.'
              : 'Try adjusting your search query.'}
          </p>
          {projects.length === 0 && (
            <button
              type="button"
              onClick={onGoToGenerator}
              className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              Open Subtitle Generator
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
          {filtered.map((proj) => (
            <div
              key={proj.id}
              className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-center gap-4 min-w-0">
                {proj.posterUrl ? (
                  <img
                    src={proj.posterUrl}
                    alt={proj.title}
                    referrerPolicy="no-referrer"
                    className="w-11 h-16 object-cover rounded border border-slate-200 shrink-0"
                  />
                ) : null}
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">
                    {proj.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1 tabular-nums">
                    <span>
                      {proj.targetLang} / {proj.baseLang}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{proj.mode}</span>
                    <span aria-hidden="true">·</span>
                    <span>{proj.cueCount} cues</span>
                    <span aria-hidden="true">·</span>
                    <span>{proj.sourceFormat.toUpperCase()}</span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(proj.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenProject(proj.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Open in Studio
                </button>
                <button
                  type="button"
                  onClick={() => onExportProject(proj.id, 'ass')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  .ASS
                </button>
                <button
                  type="button"
                  onClick={() => onExportProject(proj.id, 'srt')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  .SRT
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteProject(proj.id)}
                  aria-label={`Delete ${proj.title}`}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
