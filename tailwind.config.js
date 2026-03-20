/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        red: {
          brand: '#E53935',
          dark: '#C62828',
          light: '#FFEBEE',
        },
      },
    },
  },
  plugins: [],
};
