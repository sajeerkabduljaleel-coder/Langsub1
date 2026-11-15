import {
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { IntegrationProviderId, ProviderDiagnostic } from '../types/subtitle';

interface SettingsViewProps {
  diagnostics: ProviderDiagnostic[];
  testingProviders: Record<string, boolean>;
  onTestConnection: (provider: IntegrationProviderId | 'all') => void;
  savedProjectCount: number;
  cachedLineCount: number;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never verified';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Never verified';
  return date.toLocaleString();
}

export function SettingsView({
  diagnostics,
  testingProviders,
  onTestConnection,
  savedProjectCount,
  cachedLineCount,
}: SettingsViewProps) {
  const isTestingAll = Boolean(testingProviders.all);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Settings & Integration Diagnostics
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Inspect server-side provider configuration, verify live API connectivity, and review safe diagnostic status. API keys are never exposed to the browser.
          </p>
        </div>

        <button
          type="button"
          disabled={isTestingAll}
          onClick={() => onTestConnection('all')}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isTestingAll ? 'animate-spin' : ''}`} />
          {isTestingAll ? 'Testing All...' : 'Test All Connections'}
        </button>
      </div>

      {/* Integration Diagnostics Cards */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Provider Integration Diagnostics
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Credentials remain server-side only
          </span>
        </div>

        <div className="divide-y divide-slate-200">
          {diagnostics.map((item) => {
            const isTesting = Boolean(testingProviders[item.provider]) || isTestingAll;

            const statusMeta = (() => {
              if (isTesting) {
                return {
                  label: 'Testing...',
                  textClass: 'text-blue-700 bg-blue-50 border-blue-200',
                  icon: <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />,
                };
              }
              switch (item.verificationStatus) {
                case 'verified':
                  return {
                    label: 'Verified',
                    textClass: 'text-emerald-800 bg-emerald-50 border-emerald-200',
                    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
                  };
                case 'failed':
                  return {
                    label: 'Connection Failed',
                    textClass: 'text-red-800 bg-red-50 border-red-200',
                    icon: <XCircle className="w-3.5 h-3.5 text-red-600" />,
                  };
                case 'untested':
                  return {
                    label: 'Configured (Not Tested)',
                    textClass: 'text-amber-900 bg-amber-50 border-amber-200',
                    icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
                  };
                default:
                  return {
                    label: 'Unconfigured',
                    textClass: 'text-slate-600 bg-slate-100 border-slate-200',
                    icon: <AlertCircle className="w-3.5 h-3.5 text-slate-500" />,
                  };
              }
            })();

            return (
              <div
                key={item.provider}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {item.name}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-md border ${statusMeta.textClass}`}
                    >
                      {statusMeta.icon}
                      {statusMeta.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600 pt-1">
                    <div>
                      <span className="font-medium text-slate-700">Configuration: </span>
                      <span>
                        {item.configured ? 'Configured' : 'Missing key'} ({item.authMode})
                      </span>
                    </div>
                    <div className="tabular-nums">
                      <span className="font-medium text-slate-700">Last Successful Check: </span>
                      <span>{formatTimestamp(item.lastSuccessAt)}</span>
                    </div>
                    <div className="tabular-nums">
                      <span className="font-medium text-slate-700">Last Checked: </span>
                      <span>
                        {item.lastCheckedAt ? formatTimestamp(item.lastCheckedAt) : 'Not yet checked'}
                      </span>
                    </div>
                  </div>

                  {item.error && (
                    <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-600" />
                      <span className="break-words">{item.error}</span>
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    disabled={isTesting}
                    onClick={() => onTestConnection(item.provider)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                    Test Connection
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Server Environment Variable Reference & Cache Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Required Server Environment Variables
          </h2>
          <p className="text-xs text-slate-600">
            Configure secrets in your server environment or AI Studio Secrets panel. Keys are read exclusively on the Node/Express backend.
          </p>
          <ul className="text-xs text-slate-700 space-y-2 font-mono bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <li>
              <span className="font-semibold text-slate-900">GEMINI_API_KEY</span> — Required for translation &amp; phonetics
            </li>
            <li>
              <span className="font-semibold text-slate-900">TMDB_READ_ACCESS_TOKEN</span> — Preferred TMDB v4 Bearer token
            </li>
            <li>
              <span className="font-semibold text-slate-900">TMDB_API_KEY</span> — Optional TMDB v3 API key (compatible fallback)
            </li>
            <li>
              <span className="font-semibold text-slate-900">OPENSUBTITLES_API_KEY</span> +{' '}
              <span className="font-semibold text-slate-900">OPENSUBTITLES_USER_AGENT</span>
            </li>
            <li>
              <span className="font-semibold text-slate-900">SUBDL_API_KEY</span> — Alternative subtitle catalog provider
            </li>
          </ul>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Local Storage &amp; Translation Cache
          </h2>
          <p className="text-xs text-slate-600">
            Completed projects and validated dialogue lines are persisted atomically on the server to minimize repeat AI API calls.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Saved Projects</div>
              <div className="text-xl font-semibold text-slate-900 tabular-nums mt-0.5">
                {savedProjectCount}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Cached Dialogue Lines</div>
              <div className="text-xl font-semibold text-slate-900 tabular-nums mt-0.5">
                {cachedLineCount.toLocaleString()}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
