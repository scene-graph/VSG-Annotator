import { useState } from 'react';
import { useAppStore, useFilters } from '../../store';
import { usePredicates, useEdgeStats } from '../../hooks';
import type { EdgeType } from '../../types';
import clsx from 'clsx';

interface FiltersProps {
  videoId: string;
}

export function Filters({ videoId }: FiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const filters = useFilters();
  const updateFilter = useAppStore((state) => state.updateFilter);
  const clearFilters = useAppStore((state) => state.clearFilters);

  const { data: stats } = useEdgeStats(videoId);
  const { data: predicatesData } = usePredicates(videoId);

  // Flatten all predicates
  const allPredicates = [
    ...(predicatesData?.static || []),
    ...(predicatesData?.dynamic || []),
    ...(predicatesData?.fg_bg || []),
  ].filter((v, i, a) => a.indexOf(v) === i).sort();

  const edgeTypes: (EdgeType | undefined)[] = [undefined, 'static', 'dynamic', 'fg_bg'];
  const edgeTypeLabels = {
    undefined: 'All',
    static: 'Static',
    dynamic: 'Dynamic',
    fg_bg: 'FG-BG',
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined);

  return (
    <div className="bg-gray-800 rounded-lg p-2 space-y-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-300 text-sm font-semibold">Filters</span>
          {hasActiveFilters && !isOpen && (
            <span className="w-2 h-2 bg-blue-500 rounded-full" />
          )}
        </div>
        {hasActiveFilters && isOpen && (
          <span
            onClick={(e) => { e.stopPropagation(); clearFilters(); }}
            className="text-gray-400 hover:text-white text-xs"
          >
            Clear all
          </span>
        )}
      </button>

      {isOpen && (
        <div className="space-y-3 pt-2">
          {/* Stats display */}
          {stats && (
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="bg-gray-700 rounded p-1.5">
                <div className="text-white font-semibold">{stats.total}</div>
                <div className="text-gray-400 text-xs">Total</div>
              </div>
              <div className="bg-gray-700 rounded p-1.5">
                <div className="text-gray-400 font-semibold">{stats.static}</div>
                <div className="text-gray-500 text-xs">Static</div>
              </div>
              <div className="bg-gray-700 rounded p-1.5">
                <div className="text-orange-400 font-semibold">{stats.dynamic}</div>
                <div className="text-gray-500 text-xs">Dynamic</div>
              </div>
              <div className="bg-gray-700 rounded p-1.5">
                <div className="text-purple-400 font-semibold">{stats.fg_bg}</div>
                <div className="text-gray-500 text-xs">FG-BG</div>
              </div>
            </div>
          )}

          {/* Edge type filter */}
          <div>
            <label className="text-gray-400 text-xs uppercase block mb-2">Edge Type</label>
            <div className="flex gap-1">
              {edgeTypes.map((type) => (
                <button
                  key={String(type)}
                  onClick={() => updateFilter('edge_type', type)}
                  className={clsx(
                    'flex-1 py-0.5 px-1.5 rounded text-xs transition-colors',
                    filters.edge_type === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  )}
                >
                  {edgeTypeLabels[String(type) as keyof typeof edgeTypeLabels]}
                </button>
              ))}
            </div>
          </div>

          {/* Confidence range */}
          <div>
            <label className="text-gray-400 text-xs uppercase block mb-2">
              Confidence Range: {filters.min_confidence?.toFixed(2) || '0.00'} - {filters.max_confidence?.toFixed(2) || '1.00'}
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={filters.min_confidence || 0}
                onChange={(e) => updateFilter('min_confidence', Number(e.target.value) || undefined)}
                className="flex-1"
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={filters.max_confidence || 1}
                onChange={(e) => updateFilter('max_confidence', Number(e.target.value) || undefined)}
                className="flex-1"
              />
            </div>
          </div>

          {/* Validation status */}
          <div>
            <label className="text-gray-400 text-xs uppercase block mb-2">Validation Status</label>
            <div className="flex gap-1">
              {[undefined, true, false].map((validated) => (
                <button
                  key={String(validated)}
                  onClick={() => updateFilter('validated', validated)}
                  className={clsx(
                    'flex-1 py-1 px-2 rounded text-sm transition-colors',
                    filters.validated === validated
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  )}
                >
                  {validated === undefined ? 'All' : validated ? 'Validated' : 'Not Validated'}
                </button>
              ))}
            </div>
          </div>

          {/* Extraction round */}
          <div>
            <label className="text-gray-400 text-xs uppercase block mb-2">Extraction Source</label>
            <div className="flex gap-1">
              {[undefined, 0, 1].map((round) => (
                <button
                  key={String(round)}
                  onClick={() => updateFilter('extraction_round', round)}
                  className={clsx(
                    'flex-1 py-1 px-2 rounded text-sm transition-colors',
                    filters.extraction_round === round
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  )}
                >
                  {round === undefined ? 'All' : round === 0 ? 'PVSG GT' : 'GPT'}
                </button>
              ))}
            </div>
          </div>

          {/* Predicate filter */}
          <div>
            <label className="text-gray-400 text-xs uppercase block mb-2">Predicate</label>
            <select
              value={filters.predicate || ''}
              onChange={(e) => updateFilter('predicate', e.target.value || undefined)}
              className="w-full bg-gray-700 text-white rounded p-2 text-sm"
            >
              <option value="">All predicates</option>
              {allPredicates.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
