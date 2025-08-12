/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  safelist: [
    'ml-auto', 'mr-auto',
    'bg-blue-500', 'bg-blue-600', 'bg-blue-300',
    'bg-gray-200', 'bg-gray-50', 'bg-white',
    'text-white', 'text-gray-900', 'text-gray-700', 'text-gray-500',
    'rounded-2xl', 'rounded-3xl',
  ],
  theme: { extend: {} },
  plugins: [],
};
