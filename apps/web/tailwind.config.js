/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx,js,jsx}',
    './components/**/*.{ts,tsx,js,jsx}',
    './lib/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      fontSize: {
        sm: ['0.7rem', { lineHeight: '1rem' }],
      },
      fontFamily: {
        display: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      spacing: {
        3: '0.5rem',
      },
      boxShadow: {
        glass: '0 20px 40px -24px rgba(15,23,42,0.45)',
      },
    },
  },
  plugins: [],
};

