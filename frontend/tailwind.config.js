/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        safe:    { DEFAULT: '#16a34a', light: '#dcfce7', text: '#15803d' },
        atrisk:  { DEFAULT: '#d97706', light: '#fef3c7', text: '#b45309' },
        blocked: { DEFAULT: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
      },
      animation: {
        pulse_fast: 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
