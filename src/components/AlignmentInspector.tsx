import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Merge, Trash2 } from 'lucide-react';
import type {
  AlignedCuePair,
  AlignmentPreviewData,
  AlignmentRelationship,
} from '../types/subtitle';

interface AlignmentInspectorProps {
  preview: AlignmentPreviewData;
  hasManualEdits: boolean;
  onChangeAligned: (nextAligned: AlignedCuePair[]) => void;
  onResetAlignment: () => void;
}

function formatMs(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const m = Math.floor(clamped / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const milli = clamped % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

const REL_LABELS: Record<AlignmentRelationship, string> = {
  exact: 'Exact',
  interpolated: 'Shifted',
  'one-to-many': '1→Many',
  'many-to-one': 'Many→1',
  'unmatched-target': 'No Base Match',
  'unmatched-base': 'Unmatched Base',
  manual: 'Edited',
};

export function AlignmentInspector({
  preview,
  hasManualEdits,
  onChangeAligned,
  onResetAlignment,
}: AlignmentInspectorProps) {
  const [showUncertainOnly, setShowUncertainOnly] = useState(
    preview.stats.uncertainCount > 0,
  );
  const [isExpanded, setIsExpanded] = useState(preview.stats.uncertainCount > 0);

  const visiblePairs = preview.aligned
    .map((pair, idx) => ({ pair, idx }))
    .filter(({ pair }) => !showUncertainOnly || pair.uncertain);

  const updatePair = (idx: number, patch: Partial<AlignedCuePair>) => {
    const next = preview.aligned.map((item, i) =>
      i === idx
        ? {
            ...item,
            ...patch,
            relationship: 'manual' as const,
            confidence: 1,
            uncertain: false,
          }
        : item,
    );
    onChangeAligned(next);
  };

  const mergeWithPrev = (idx: number) => {
    if (idx <= 0) return;
    const prev = preview.aligned[idx - 1];
    const curr = preview.aligned[idx];
    const mergedTarget = [prev.targetText, curr.targetText]
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const mergedBase = [prev.baseText, curr.baseText]
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const next = preview.aligned
      .map((item, i) =>
        i === idx - 1
          ? {
              ...item,
              startMs: Math.min(prev.startMs, curr.startMs),
              endMs: Math.max(prev.endMs, curr.endMs),
              targetText: mergedTarget,
              baseText: mergedBase,
              relationship: 'manual' as const,
              confidence: 1,
              uncertain: false,
            }
          : item,
      )
      .filter((_, i) => i !== idx)
      .map((item, i) => ({ ...item, index: i + 1 }));

    onChangeAligned(next);
  };

  const removePair = (idx: number) => {
    const next = preview.aligned
      .filter((_, i) => i !== idx)
      .map((item, i) => ({ ...item, index: i + 1 }));
    onChangeAligned(next);
  };

  const { stats } = preview;

  return (
    <div className="p-3.5 rounded-lg bg-blue-50/70 border border-blue-200 text-xs text-slate-800 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-900 tabular-nums">
          Alignment Diagnostics · Avg {Math.round(stats.averageConfidence * 100)}% · Offset{' '}
          {stats.estimatedOffsetMs >= 0 ? '+' : ''}
          {stats.estimatedOffsetMs} ms
        </div>
        <div className="flex items-center gap-2">
          {hasManualEdits && (
            <button
              type="button"
              onClick={onResetAlignment}
              className="text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
            >
              Reset Auto-Align
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="px-2 py-1 text-[11px] font-semibold bg-white border border-blue-200 rounded text-slate-800 hover:bg-slate-50 cursor-pointer"
          >
            {isExpanded ? 'Hide Inspector' : `Inspect Matches (${preview.aligned.length})`}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-700 tabular-nums">
        <span>Exact: {stats.exactMatches}</span>
        <span>·</span>
        <span>Shifted: {stats.interpolatedMatches}</span>
        <span>·</span>
        <span>1→Many: {stats.oneToManyMatches}</span>
        <span>·</span>
        <span>Many→1: {stats.manyToOneMatches}</span>
        <span>·</span>
        <span>Unmatched Target: {stats.unmatchedTarget}</span>
        <span>·</span>
        <span>Unmatched Base: {stats.unmatchedBase}</span>
      </div>

      {stats.uncertainCount > 0 ? (
        <div className="flex items-center gap-1.5 text-amber-800 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            {stats.uncertainCount} uncertain or unmatched cue(s) preserved — inspect or adjust below before converting.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-emerald-800 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>All {preview.aligned.length} cues aligned with high confidence.</span>
        </div>
      )}

      {isExpanded && (
        <div className="pt-2 border-t border-blue-200/80 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showUncertainOnly}
                onChange={(e) => setShowUncertainOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>
                Show uncertain / unmatched only ({stats.uncertainCount})
              </span>
            </label>
            <span className="text-[11px] text-slate-500 tabular-nums">
              Showing {visiblePairs.length} of {preview.aligned.length}
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {visiblePairs.length === 0 ? (
              <div className="p-3 bg-white rounded border border-blue-100 text-center text-slate-500">
                No uncertain cues. Uncheck the filter above to inspect all aligned pairs.
              </div>
            ) : (
              visiblePairs.map(({ pair, idx }) => (
                <div
                  key={pair.id}
                  className={`p-2.5 rounded-lg border bg-white space-y-1.5 ${
                    pair.uncertain ? 'border-amber-300' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 tabular-nums font-mono text-slate-600">
                      <span className="font-semibold text-slate-900">#{pair.index}</span>
                      <span>
                        {formatMs(pair.startMs)}→{formatMs(pair.endMs)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-sans font-semibold ${
                          pair.confidence >= 0.7
                            ? 'bg-emerald-50 text-emerald-700'
                            : pair.confidence >= 0.4
                              ? 'bg-amber-50 text-amber-800'
                              : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {Math.round(pair.confidence * 100)}% · {REL_LABELS[pair.relationship]}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => mergeWithPrev(idx)}
                          title="Merge this cue into previous cue"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                        >
                          <Merge className="w-3 h-3" />
                          Merge Prev
                        </button>
                      )}
                      {preview.aligned.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePair(idx)}
                          title="Exclude this cue from conversion"
                          className="p-1 rounded border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1">
                    <input
                      type="text"
                      value={pair.targetText}
                      placeholder="Target dialogue (empty -> AI will translate from Base)"
                      onChange={(e) => updatePair(idx, { targetText: e.target.value })}
                      className="w-full px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded text-slate-900"
                    />
                    <input
                      type="text"
                      value={pair.baseText}
                      placeholder="Base translation (empty -> AI will translate from Target)"
                      onChange={(e) => updatePair(idx, { baseText: e.target.value })}
                      className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded text-slate-900"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
