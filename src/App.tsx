import { useState } from 'react';
import { InputForm } from './components/InputForm';
import { ResultsTable } from './components/ResultsTable';
import type { PlayerStats, Region, LookupResponse } from './types';

function App() {
  const [results, setResults] = useState<PlayerStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async (ranks: (string | number)[], region: Region) => {
    setIsLoading(true);
    setError(null);
    setResults([]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/leaderboard-lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ranks, region }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const data: LookupResponse = await response.json();

      if (data.success) {
        const successRows = data.data;
        const errorRows = data.errors.map(err => ({
          rank_input: err.rank_input,
          riot_id: 'Unknown',
          current_rank: '-',
          kd: '-',
          wr: '-',
          games_played: 0,
          wins: 0,
          tracker_url: '#',
          cached: false,
          error: err.error
        }));

        const allResults = [...successRows, ...errorRows].sort((a, b) => {
          const aNum = Number(a.rank_input);
          const bNum = Number(b.rank_input);

          if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
          if (!isNaN(aNum) && isNaN(bNum)) return -1;
          if (isNaN(aNum) && !isNaN(bNum)) return 1;

          return String(a.rank_input).localeCompare(String(b.rank_input));
        });

        setResults(allResults);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setError((data as any).error || 'Failed to fetch data');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(err);
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timed out after 30 seconds');
      } else {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center text-sm text-tui-fg-dim border-b border-tui-border pb-4 gap-2">
        <div className="flex items-center gap-4">
          <span className="text-tui-blue font-bold text-2xl relative z-50">GETRANK</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col gap-8">
        <section>
          <div className="tui-panel">
            <h2 className="tui-panel-title">QUERY_PARAMETERS</h2>
            <div className="mb-6 text-tui-fg-dim text-sm max-w-2xl">
              <p>Enter last act leaderboard ranks or Riot IDs (name#tag) to fetch statistics.</p>
            </div>

            <InputForm onSubmit={handleLookup} isLoading={isLoading} />
          </div>
        </section>

        {error && (
          <div className="border border-tui-red/50 bg-tui-red/5 p-4 text-tui-red text-sm font-mono">
            [!] ERROR: {error}
          </div>
        )}

        {(results.length > 0 || isLoading) && (
          <section className="flex-1 min-h-[400px]">
            <div className="tui-panel h-full flex flex-col">
              <h2 className="tui-panel-title">OUTPUT_LOGS</h2>
              {isLoading && results.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-tui-fg-dim animate-pulse">
                  &gt; Fetching data streams...
                </div>
              ) : (
                <ResultsTable results={results} />
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-tui-border pt-4 text-xs text-tui-fg-dim flex gap-6">
        <span>[Enter] Submit Query</span>
        <span>[Tab] Next Field</span>
        <span>[Click] View Profile</span>
      </footer>
    </div>
  );
}

export default App;
