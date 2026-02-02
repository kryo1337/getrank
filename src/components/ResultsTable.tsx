import React from 'react';
import type { PlayerStats } from '../types';

interface ResultsTableProps {
  results: PlayerStats[];
}

function buildTrackerUrl(riotId: string): string {
  const sanitizedId = encodeURIComponent(riotId);
  return `https://tracker.gg/valorant/profile/riot/${sanitizedId}/overview`;
}

const getRankColorClasses = (rankStr: string) => {
  const rank = rankStr.toLowerCase();
  
  if (rank.includes('radiant')) return 'text-yellow-400';
  if (rank.includes('immortal')) return 'text-tui-red';
  if (rank.includes('ascendant')) return 'text-tui-green';
  if (rank.includes('diamond')) return 'text-tui-violet';
  if (rank.includes('platinum')) return 'text-tui-cyan';
  if (rank.includes('gold')) return 'text-tui-orange';
  if (rank.includes('silver')) return 'text-gray-400';
  
  return 'text-tui-fg-dim';
};

const getStatColors = (value: number, threshold: number) => {
  const epsilon = 0.01;
  if (Math.abs(value - threshold) < epsilon) return { bg: 'bg-tui-orange', text: 'text-tui-orange' };
  if (value > threshold) return { bg: 'bg-tui-green', text: 'text-tui-green' };
  return { bg: 'bg-tui-red', text: 'text-tui-red' };
};

export const ResultsTable: React.FC<ResultsTableProps> = ({ results }) => {
  if (results.length === 0) return null;

  return (
    <div className="w-full">
      {/* Mobile Card View (< md) */}
      <div className="block md:hidden space-y-4">
        {results.map((player, index) => {
           const isError = !!player.error;
           const kd = parseFloat(player.kd ?? '0');
           const wr = parseFloat((player.wr ?? '0').replace('%', ''));
           const kdVal = isNaN(kd) ? 0 : kd;
           const wrVal = isNaN(wr) ? 0 : wr;
           
           const kdColors = getStatColors(kdVal, 1.0);
           const wrColors = getStatColors(wrVal, 50.0);
           const uniqueKey = `${player.riot_id}-${player.rank_input}-${player.cached ? 'cached' : 'fresh'}-${index}`;

           return (
             <div 
               key={uniqueKey}
               className={`p-4 border border-tui-border bg-tui-bg-dim/50 rounded flex flex-col gap-3 ${
                 isError ? 'border-tui-red/50 bg-tui-red/5' : ''
               }`}
             >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs text-tui-fg-dim uppercase block">Rank / Input</span>
                    <span className="font-bold text-tui-fg">{player.rank_input}</span>
                  </div>
                   {!isError && (
                      <a
                        href={buildTrackerUrl(player.riot_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-tui-blue border border-tui-blue px-3 py-2 rounded uppercase hover:bg-tui-blue hover:text-white transition-colors"
                      >
                        View Profile
                      </a>
                   )}
                </div>

                {isError ? (
                  <div className="text-tui-red italic text-sm">
                    Error: {player.error}
                  </div>
                ) : (
                  <>
                    <div>
                      <span className="text-xs text-tui-fg-dim uppercase block">Riot ID</span>
                      <span className="font-bold text-lg text-tui-fg break-all">{player.riot_id}</span>
                    </div>
                   
                   <div className="grid grid-cols-2 gap-4">
                     <div>
                       <span className="text-xs text-tui-fg-dim uppercase block">Current Rank</span>
                       <span className={`font-bold uppercase ${getRankColorClasses(player.current_rank)}`}>
                          {player.current_rank}
                       </span>
                     </div>
                     <div>
                       <span className="text-xs text-tui-fg-dim uppercase block">Games</span>
                       <span className="text-tui-fg-dim">{player.games_played}</span>
                     </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4 pt-2 border-t border-tui-border/30">
                     <div>
                       <span className="text-xs text-tui-fg-dim uppercase block">K/D Ratio</span>
                       <span className={`font-mono font-bold ${kdColors.text}`}>{kdVal.toFixed(2)}</span>
                     </div>
                     <div>
                        <span className="text-xs text-tui-fg-dim uppercase block">Win Rate</span>
                        <span className={`font-mono font-bold ${wrColors.text}`}>{wrVal.toFixed(1)}%</span>
                     </div>
                   </div>
                 </>
               )}
             </div>
           );
        })}
      </div>

      {/* Desktop Table View (>= md) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm font-mono border-collapse">
          <thead>
            <tr className="text-tui-fg-dim text-xs uppercase tracking-wider border-b border-tui-border">
              <th className="p-3 whitespace-nowrap">Rank / Input</th>
              <th className="p-3 whitespace-nowrap">ID</th>
              <th className="p-3 whitespace-nowrap">Tier</th>
              <th className="p-3 whitespace-nowrap">K/D Ratio</th>
              <th className="p-3 whitespace-nowrap">Win Rate %</th>
              <th className="p-3 whitespace-nowrap">Games</th>
              <th className="p-3 text-right whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-tui-border/30">
            {results.map((player, index) => {
              const isError = !!player.error;
              const kd = parseFloat(player.kd ?? '0');
              const wr = parseFloat((player.wr ?? '0').replace('%', ''));
              const kdVal = isNaN(kd) ? 0 : kd;
              const wrVal = isNaN(wr) ? 0 : wr;
              
              const kdColors = getStatColors(kdVal, 1.0);
              const wrColors = getStatColors(wrVal, 50.0);
              const uniqueKey = `${player.riot_id}-${player.rank_input}-${player.cached ? 'cached' : 'fresh'}-${index}`;
              
                return (
                  <tr
                    key={uniqueKey}
                    className={`transition-colors hover:bg-tui-blue/5 ${
                      isError ? 'bg-tui-red/5' : ''
                    }`}
                  >
                    <td className="p-3 text-tui-fg-dim font-bold whitespace-nowrap">{player.rank_input}</td>
                    
                    {isError ? (
                      <td colSpan={6} className="p-3 text-tui-red italic">
                        Error: {player.error}
                      </td>
                    ) : (
                      <>
                        <td className="p-3 font-bold text-tui-fg whitespace-nowrap">
                          <a
                            href={buildTrackerUrl(player.riot_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-tui-blue hover:underline decoration-1 underline-offset-4"
                          >
                            {player.riot_id}
                          </a>
                        </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`font-bold uppercase ${getRankColorClasses(player.current_rank)}`}>
                           {player.current_rank}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                         <span className={`font-mono ${kdColors.text}`}>{kdVal.toFixed(2)}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                         <span className={`font-mono ${wrColors.text}`}>{wrVal.toFixed(1)}%</span>
                      </td>
                      <td className="p-3 text-tui-fg-dim whitespace-nowrap">{player.games_played}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <a
                          href={buildTrackerUrl(player.riot_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-tui-blue hover:text-white hover:bg-tui-blue px-2 py-1 transition-colors"
                        >
                          [ VIEW ]
                        </a>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

