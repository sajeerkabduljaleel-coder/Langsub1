import { ArrowDown, ArrowUp, Download, RotateCcw } from 'lucide-react';
import {
  DEFAULT_STYLE_CONFIG,
  type AssStyleConfig,
  type SubtitleLineRole,
  type TriLineCue,
} from '../types/subtitle';

interface StyleExportPanelProps {
  styleConfig: AssStyleConfig;
  onChangeStyle: (next: AssStyleConfig) => void;
  cues: TriLineCue[];
  onDownloadSrt: () => void;
  onDownloadAss: () => void;
  isExporting: boolean;
}

const ROLE_LABELS: Record<SubtitleLineRole, string> = {
  base: 'Base Language (Comprehension)',
  target: 'Target Language (Dialogue)',
  phonetic: 'Intuitive Phonetics (Pronunciation)',
};

export function StyleExportPanel({
  styleConfig,
  onChangeStyle,
  cues,
  onDownloadSrt,
  onDownloadAss,
  isExporting,
}: StyleExportPanelProps) {
  const moveRole = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= styleConfig.lineOrder.length) return;
    const nextOrder = [...styleConfig.lineOrder];
    const [moved] = nextOrder.splice(idx, 1);
    nextOrder.splice(targetIdx, 0, moved);
    onChangeStyle({ ...styleConfig, lineOrder: nextOrder });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
      {/* Header & Primary Export Actions */}
      <div className="p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Subtitle Styling & Export
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Configure ASS visual hierarchy, line order, colors, and download player-ready files.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onChangeStyle(DEFAULT_STYLE_CONFIG)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>

          <button
            type="button"
            disabled={cues.length === 0 || isExporting}
            onClick={onDownloadSrt}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download .SRT
          </button>

          <button
            type="button"
            disabled={cues.length === 0 || isExporting}
            onClick={onDownloadAss}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download .ASS
          </button>
        </div>
      </div>

      {/* Line Order & Language Colors */}
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Three-Line Display Order
          </h3>
          <div className="space-y-2">
            {styleConfig.lineOrder.map((role, idx) => {
              const colorVal =
                role === 'base'
                  ? styleConfig.baseColor
                  : role === 'target'
                    ? styleConfig.targetColor
                    : styleConfig.phoneticColor;

              const sizeVal =
                role === 'base'
                  ? styleConfig.baseFontSize
                  : role === 'target'
                    ? styleConfig.targetFontSize
                    : styleConfig.phoneticFontSize;

              return (
                <div
                  key={role}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs tabular-nums text-slate-500 w-4">
                      {idx + 1}.
                    </span>
                    <input
                      type="color"
                      value={colorVal}
                      aria-label={`${ROLE_LABELS[role]} color`}
                      onChange={(e) => {
                        const hex = e.target.value.toUpperCase();
                        if (role === 'base') {
                          onChangeStyle({ ...styleConfig, baseColor: hex });
                        } else if (role === 'target') {
                          onChangeStyle({ ...styleConfig, targetColor: hex });
                        } else {
                          onChangeStyle({ ...styleConfig, phoneticColor: hex });
                        }
                      }}
                      className="w-7 h-7 rounded border border-slate-300 bg-transparent cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {ROLE_LABELS[role]}
                      </div>
                      <div className="text-xs font-mono tabular-nums text-slate-500">
                        {colorVal} · {sizeVal}px (1080p ASS)
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveRole(idx, -1)}
                      aria-label={`Move ${role} up`}
                      className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === styleConfig.lineOrder.length - 1}
                      onClick={() => moveRole(idx, 1)}
                      aria-label={`Move ${role} down`}
                      className="p-1.5 rounded border border-slate-200 bg-white text-slate-600 hover:text-slate-900 disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Typography & Geometry Controls */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Typography & Positioning
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Font Family</span>
              <select
                value={styleConfig.fontFamily}
                onChange={(e) =>
                  onChangeStyle({ ...styleConfig, fontFamily: e.target.value })
                }
                className="mt-1 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
              >
                <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                <option value="Arial">Arial (Universal Player Default)</option>
                <option value="Noto Sans">Noto Sans (Extended Unicode)</option>
                <option value="Verdana">Verdana</option>
                <option value="Trebuchet MS">Trebuchet MS</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-700">Screen Position</span>
              <select
                value={styleConfig.alignment}
                onChange={(e) =>
                  onChangeStyle({
                    ...styleConfig,
                    alignment: Number(e.target.value) as 2 | 8,
                  })
                }
                className="mt-1 w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
              >
                <option value={2}>Bottom Center (\an2)</option>
                <option value={8}>Top Center (\an8)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <span>Base Size</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {styleConfig.baseFontSize}px
                </span>
              </div>
              <input
                type="range"
                min={28}
                max={64}
                value={styleConfig.baseFontSize}
                onChange={(e) =>
                  onChangeStyle({ ...styleConfig, baseFontSize: Number(e.target.value) })
                }
                className="mt-1.5 w-full accent-blue-600 cursor-pointer"
              />
            </label>

            <label className="block">
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <span>Target Size</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {styleConfig.targetFontSize}px
                </span>
              </div>
              <input
                type="range"
                min={30}
                max={72}
                value={styleConfig.targetFontSize}
                onChange={(e) =>
                  onChangeStyle({ ...styleConfig, targetFontSize: Number(e.target.value) })
                }
                className="mt-1.5 w-full accent-blue-600 cursor-pointer"
              />
            </label>

            <label className="block">
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <span>Phonetic Size</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {styleConfig.phoneticFontSize}px
                </span>
              </div>
              <input
                type="range"
                min={26}
                max={60}
                value={styleConfig.phoneticFontSize}
                onChange={(e) =>
                  onChangeStyle({ ...styleConfig, phoneticFontSize: Number(e.target.value) })
                }
                className="mt-1.5 w-full accent-blue-600 cursor-pointer"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <span>Vertical Margin</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {styleConfig.marginV}px
                </span>
              </div>
              <input
                type="range"
                min={16}
                max={120}
                value={styleConfig.marginV}
                onChange={(e) =>
                  onChangeStyle({ ...styleConfig, marginV: Number(e.target.value) })
                }
                className="mt-1.5 w-full accent-blue-600 cursor-pointer"
              />
            </label>

            <label className="block">
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <span>Backdrop Opacity</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {styleConfig.opaqueBox ? `${styleConfig.boxOpacity}%` : 'Outline only'}
                </span>
              </div>
              <input
                type="range"
                min={15}
                max={90}
                disabled={!styleConfig.opaqueBox}
                value={styleConfig.boxOpacity}
                onChange={(e) =>
                  onChangeStyle({ ...styleConfig, boxOpacity: Number(e.target.value) })
                }
                className="mt-1.5 w-full accent-blue-600 disabled:opacity-40 cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Format Compatibility Options */}
      <div className="px-5 py-4 bg-slate-50 flex flex-wrap items-center gap-6 text-sm text-slate-700">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={styleConfig.opaqueBox}
            onChange={(e) =>
              onChangeStyle({ ...styleConfig, opaqueBox: e.target.checked })
            }
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>ASS Opaque Backdrop Box</span>
        </label>

        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={styleConfig.srtIncludeColorTags}
            onChange={(e) =>
              onChangeStyle({ ...styleConfig, srtIncludeColorTags: e.target.checked })
            }
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Include HTML Color Tags in .SRT (for VLC/Kodi)</span>
        </label>

        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={styleConfig.srtIncludeBom}
            onChange={(e) =>
              onChangeStyle({ ...styleConfig, srtIncludeBom: e.target.checked })
            }
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>UTF-8 BOM in .SRT</span>
        </label>
      </div>
    </div>
  );
}
