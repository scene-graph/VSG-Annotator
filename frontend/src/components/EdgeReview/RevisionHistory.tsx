import type { Revision } from '../../types';
import clsx from 'clsx';

interface RevisionHistoryProps {
  revisions: Revision[];
}

export function RevisionHistory({ revisions }: RevisionHistoryProps) {
  if (revisions.length === 0) {
    return (
      <div className="mt-2 text-gray-500 text-sm">No revisions yet</div>
    );
  }

  const actionColors = {
    accept: 'text-green-400 bg-green-500/20',
    reject: 'text-red-400 bg-red-500/20',
    modify: 'text-yellow-400 bg-yellow-500/20',
    create: 'text-blue-400 bg-blue-500/20',
  };

  return (
    <div className="mt-2 space-y-2">
      {revisions.map((revision) => (
        <div key={revision.id} className="bg-gray-700/50 rounded p-2 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx('px-2 py-0.5 rounded text-xs', actionColors[revision.action as keyof typeof actionColors] || 'text-gray-400 bg-gray-500/20')}>
              {revision.action}
            </span>
            <span className="text-gray-400">by</span>
            <span className="text-white">{revision.username}</span>
            <span className="text-gray-500 text-xs ml-auto">
              {new Date(revision.created_at).toLocaleString()}
            </span>
          </div>

          {(revision.action === 'modify' || revision.action === 'accept') &&
            (revision.new_predicate || revision.new_time_periods || revision.new_time_period || revision.new_attributes) && (
            <div className="text-xs space-y-1 mt-2">
              {revision.original_predicate && revision.new_predicate && (
                <div>
                  <span className="text-gray-500">Predicate:</span>{' '}
                  <span className="text-red-400 line-through">{revision.original_predicate}</span>{' '}
                  <span className="text-gray-500">→</span>{' '}
                  <span className="text-green-400">{revision.new_predicate}</span>
                </div>
              )}
              {(revision.new_time_periods || revision.new_time_period) && (
                <div>
                  <span className="text-gray-500">Time Period:</span>{' '}
                  <span className="text-green-400">
                    {(revision.new_time_periods && revision.new_time_periods.length > 0
                      ? revision.new_time_periods
                      : revision.new_time_period
                        ? [revision.new_time_period]
                        : []
                    )
                      .map((tp) => `${tp.start_frame} - ${tp.end_frame}`)
                      .join(', ')}
                  </span>
                </div>
              )}
              {revision.new_attributes && (
                <div>
                  <span className="text-gray-500">Attributes:</span>{' '}
                  <span className="text-green-400">
                    {revision.new_attributes.velocity}, {revision.new_attributes.direction}, {revision.new_attributes.trajectory}
                  </span>
                </div>
              )}
            </div>
          )}

          {revision.review_notes && (
            <div className="text-gray-400 text-xs mt-2 italic">
              "{revision.review_notes}"
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
