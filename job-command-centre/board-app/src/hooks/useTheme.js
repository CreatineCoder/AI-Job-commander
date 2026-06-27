import { useCallback, useEffect, useState } from "react";

const KEY = "lemma-app-theme";

function readTheme() {
  try {
    return localStorage.getItem(KEY) || "light";
  } catch (e) {
    return "light";
  }
}

// Manages the light/dark theme: persists to localStorage and reflects it on
// <html data-theme>. Returns [theme, toggle].
export function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return [theme, toggle];
}
