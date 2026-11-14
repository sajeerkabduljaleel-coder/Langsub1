import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { AssStyleConfig, TriLineCue } from '../types/subtitle';

interface CueEditorTableProps {
  cues: TriLineCue[];
  styleConfig: AssStyleConfig;
  activeCueIndex: number;
  onSelectCueIndex: (idx: number) => void;
  onUpdateCue: (idx: number, patch: Partial<TriLineCue>) => void;
  hasUnsavedEdits: boolean;
  onSaveEdits: () => void;
  isSaving: boolean;
}

function formatShortTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const milli = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export function CueEditorTable({
  cues,
  styleConfig,
  activeCueIndex,
  onSelectCueIndex,
  onUpdateCue,
  hasUnsavedEdits,
  onSaveEdits,
  isSaving,
}: CueEditorTableProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return cues.map((cue, originalIndex) => ({ cue, originalIndex }));
    }
    return cues
      .map((cue, originalIndex) => ({ cue, originalIndex }))
      .filter(
        ({ cue }) =>
          cue.baseText.toLowerCase().includes(q) ||
          cue.targetText.toLowerCase().includes(q) ||
          cue.phoneticText.toLowerCase().includes(q),
      );
  }, [cues, searchQuery]);

  if (cues.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h3 className="text-base font-semibold text-slate-900">
          No generated three-line cues yet
        </h3>
        <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
          Upload a subtitle file or select a sample dataset on the left, then generate your synchronized three-line track to inspect and edit every cue here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Synchronized Cue Editor
          </h3>
          <span className="text-xs text-slate-500 tabular-nums">
            {filteredCues.length} of {cues.length} cues
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter dialogue or phonetics..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 w-56 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          {hasUnsavedEdits && (
            <button
              type="button"
              disabled={isSaving}
              onClick={onSaveEdits}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {/* Cue Rows */}
      <div className="max-h-[540px] overflow-y-auto divide-y divide-slate-200">
        {filteredCues.map(({ cue, originalIndex }) => {
          const isActive = originalIndex === activeCueIndex;
          return (
            <div
              key={cue.id}
              onClick={() => onSelectCueIndex(originalIndex)}
              className={`p-4 transition-colors cursor-pointer ${
                isActive ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold tabular-nums text-slate-800">
                    #{cue.index}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {formatShortTime(cue.startMs)} → {formatShortTime(cue.endMs)}
                  </span>
                  {cue.cacheHit && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-700 font-medium">Cached</span>
                    </>
                  )}
                  {typeof cue.alignmentConfidence === 'number' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`tabular-nums font-medium ${
                          cue.alignmentConfidence >= 0.7
                            ? 'text-slate-600'
                            : cue.alignmentConfidence >= 0.4
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }`}
                      >
                        Match {Math.round(cue.alignmentConfidence * 100)}%
                        {cue.alignmentRelationship && cue.alignmentRelationship !== 'exact'
                          ? ` (${cue.alignmentRelationship})`
                          : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0 border border-slate-300"
                    style={{ backgroundColor: styleConfig.baseColor }}
                    title="Base Language"
                  />
                  <span className="text-xs font-medium text-slate-500 w-16 shrink-0">
                    Base
                  </span>
                  <input
                    type="text"
                    value={cue.baseText}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCueIndex(originalIndex);
                    }}
                    onChange={(e) =>
                      onUpdateCue(originalIndex, { baseText: e.target.value, edited: true })
                    }
                    className="flex-1 px-2.5 py-1 text-sm text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                </div>

                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0 border border-slate-300"
                    style={{ backgroundColor: styleConfig.targetColor }}
                    title="Target Language"
                  />
                  <span className="text-xs font-medium text-slate-500 w-16 shrink-0">
                    Target
                  </span>
                  <input
                    type="text"
                    value={cue.targetText}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCueIndex(originalIndex);
                    }}
                    onChange={(e) =>
                      onUpdateCue(originalIndex, { targetText: e.target.value, edited: true })
                    }
                    className="flex-1 px-2.5 py-1 text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                </div>

                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0 border border-slate-300"
                    style={{ backgroundColor: styleConfig.phoneticColor }}
                    title="Intuitive Phonetics"
                  />
                  <span className="text-xs font-medium text-slate-500 w-16 shrink-0">
                    Phonetics
                  </span>
                  <input
                    type="text"
                    value={cue.phoneticText}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCueIndex(originalIndex);
                    }}
                    onChange={(e) =>
                      onUpdateCue(originalIndex, {
                        phoneticText: e.target.value,
                        edited: true,
                      })
                    }
                    className="flex-1 px-2.5 py-1 text-sm font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
