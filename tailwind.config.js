/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tui: {
          bg: '#16161e',
          'bg-alt': '#1a1b26',
          fg: '#a9b1d6',
          'fg-dim': '#565f89',
          blue: '#7aa2f7',
          cyan: '#7dcfff',
          green: '#9ece6a',
          orange: '#ff9e64',
          red: '#f7768e',
          violet: '#bb9af7',
          border: '#414868',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        sans: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'glow': '0 0 10px rgba(122, 162, 247, 0.2)',
      }
    },
  },
  plugins: [],
}
