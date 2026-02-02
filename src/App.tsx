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
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      let apiUrl = import.meta.env.VITE_API_URL || '';
      if (apiUrl.endsWith('/')) {
        apiUrl = apiUrl.slice(0, -1);
      }

      const fullUrl = `${apiUrl}/api/leaderboard-lookup`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ranks, region }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const data: LookupResponse = await response.json();
      processResponse(data);

    } catch (err) {
      clearTimeout(timeoutId);
      console.error(err);
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timed out after 60 seconds');
      } else {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  function processResponse(data: LookupResponse) {
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
      setError((data as any).error || 'Failed to fetch data');
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center text-sm text-tui-fg-dim border-b border-tui-border pb-4 gap-2">
        <div className="flex items-center gap-4">
          <span className="text-tui-blue font-bold text-2xl relative z-50">GETRANK</span>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://buymeacoffee.com/kryo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-tui-fg-dim hover:text-tui-blue transition-colors"
            title="Buy Me a Coffee"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
          </a>
          <a
            href="https://x.com/kryoxd"
            target="_blank"
            rel="noopener noreferrer"
            className="text-tui-fg-dim hover:text-tui-blue transition-colors"
            title="X (Twitter)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
              <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
            </svg>
          </a>
          <a
            href="https://github.com/kryo1337/getrank"
            target="_blank"
            rel="noopener noreferrer"
            className="text-tui-fg-dim hover:text-tui-blue transition-colors"
            title="GitHub"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 1.19 6.44 1.54A3.37 3.37 0 0 0 9 15.13V19" />
            </svg>
          </a>
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

      <footer className="border-t border-tui-border pt-4 text-xs text-tui-fg-dim flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex gap-6">
          <span>[Enter] Submit Query</span>
          <span>[Tab] Next Field</span>
          <span>[Click] View Profile</span>
        </div>
        <div className="flex flex-col items-end text-right gap-1">
          <a href="https://www.kryo.dev/" target="_blank" rel="noopener noreferrer" className="hover:text-tui-blue transition-colors">
            developed by kryo
          </a>
          <span>© 2026 getrank</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
