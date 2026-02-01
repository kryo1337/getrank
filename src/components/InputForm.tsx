import React, { useState } from 'react';
import type { Region } from '../types';

interface InputFormProps {
  onSubmit: (ranks: string[], region: Region) => void;
  isLoading: boolean;
}

export const InputForm: React.FC<InputFormProps> = ({ onSubmit, isLoading }) => {
  const [input, setInput] = useState('');
  const [region, setRegion] = useState<Region>('eu');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const ranks = input
      .split(/[,\n\r]+/)
      .map(r => r.trim())
      .filter(r => r.length > 0);

    const validInputs = ranks.filter(r => /^\d+$/.test(r) || /^.+#[^#]+$/.test(r));

    if (validInputs.length === 0) {
      alert('Please enter valid rank numbers or Riot IDs (e.g. name#tag)');
      return;
    }

    onSubmit(validInputs, region);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">

        <div className="md:col-span-8">
          <label htmlFor="ranks" className="block text-xs font-bold text-tui-blue uppercase mb-2">
            Target_Ranks / Riot_IDs
          </label>
          <div className="tui-input-group">
            <span className="text-tui-fg-dim pl-2 select-none">&gt;</span>
            <input
              id="ranks"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. 241, Player#NA1, 652"
              className="tui-input min-h-[44px]"
              disabled={isLoading}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="md:col-span-4">
          <label htmlFor="region" className="block text-xs font-bold text-tui-blue uppercase mb-2">
            Server_Region
          </label>
          <div className="tui-input-group">
            <span className="text-tui-fg-dim pl-2 select-none">@</span>
            <select
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              className="tui-input cursor-pointer appearance-none bg-transparent min-h-[44px]"
              disabled={isLoading}
            >
              <option value="eu" className="bg-tui-bg">Europe (EU)</option>
              <option value="na" className="bg-tui-bg">North America (NA)</option>
              <option value="ap" className="bg-tui-bg">Asia Pacific (AP)</option>
              <option value="kr" className="bg-tui-bg">Korea (KR)</option>
              <option value="br" className="bg-tui-bg">Brazil (BR)</option>
              <option value="latam" className="bg-tui-bg">LATAM</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-tui-fg-dim">
              <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className={`tui-btn min-h-[44px] ${isLoading || !input.trim()
              ? 'opacity-50 cursor-not-allowed'
              : 'tui-btn-primary'
            }`}
        >
          {isLoading ? '[ EXECUTING... ]' : '[ INITIALIZE_SCAN ]'}
        </button>
      </div>
    </form>
  );
};
