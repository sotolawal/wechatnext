export default {
  darkMode: "class",
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#202123",            // app chrome / panels
        bubbleAssistant: "#3b3d45",  // assistant message bubble
        bubbleUser: "#195cab",        // user message bubble (base, adjust opacity in classes)
        accent: "#10a37f",            // ChatGPT green
      },
      boxShadow: {
        bubble: "0 1px 2px 0 rgba(0,0,0,0.20)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "Apple Color Emoji",
          "Segoe UI Emoji",
        ],
      },
    },
  },
  plugins: [],
};
