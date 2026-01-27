import clsx from 'clsx';

interface ValidationReasoningProps {
  round1: string;
  round2: string;
  isOpen: boolean;
  onToggle: () => void;
}

export function ValidationReasoning({ round1, round2, isOpen, onToggle }: ValidationReasoningProps) {
  const hasReasoning = round1 || round2;

  if (!hasReasoning) {
    return null;
  }

  return (
    <div className="bg-gray-700 rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-600 transition-colors"
      >
        <span className="text-gray-400 text-xs uppercase">Validation Reasoning</span>
        <svg
          className={clsx('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="p-3 pt-0 space-y-3">
          {round1 && (
            <div>
              <div className="text-blue-400 text-xs font-semibold mb-1">Round 1</div>
              <div className="text-gray-300 text-sm leading-relaxed">{round1}</div>
            </div>
          )}
          {round2 && (
            <div>
              <div className="text-purple-400 text-xs font-semibold mb-1">Round 2</div>
              <div className="text-gray-300 text-sm leading-relaxed">{round2}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
