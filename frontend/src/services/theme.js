import { useState, useEffect } from "react";

function getStoredTheme() {
  try {
    return localStorage.getItem("sahasraksha_theme") || "light";
  } catch {
    return "light";
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState(getStoredTheme);

  useEffect(() => {
    const handleThemeEvent = (e) => {
      const newTheme = e.detail?.theme || getStoredTheme();
      setThemeState(newTheme);
      document.documentElement.setAttribute("data-theme", newTheme);
    };

    window.addEventListener("sahasraksha-theme-changed", handleThemeEvent);
    window.addEventListener("storage", handleThemeEvent);

    // Initial sync
    document.documentElement.setAttribute("data-theme", theme);

    return () => {
      window.removeEventListener("sahasraksha-theme-changed", handleThemeEvent);
      window.removeEventListener("storage", handleThemeEvent);
    };
  }, [theme]);

  const setTheme = (nextTheme) => {
    try {
      localStorage.setItem("sahasraksha_theme", nextTheme);
    } catch {}
    document.documentElement.setAttribute("data-theme", nextTheme);
    setThemeState(nextTheme);
    window.dispatchEvent(
      new CustomEvent("sahasraksha-theme-changed", { detail: { theme: nextTheme } })
    );
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  };

  return { theme, setTheme, toggleTheme, isDark: theme === "dark" };
}
