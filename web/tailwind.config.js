/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  // 雛形の animate-in / fade-in / slide-in 系クラスを活かす
  plugins: [require("tailwindcss-animate")],
};
