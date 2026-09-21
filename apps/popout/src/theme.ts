export const THEMES = [
  { id: "midnight", label: "Midnight", note: "Code school dark" },
  { id: "daylight", label: "Daylight", note: "Light" },
  { id: "lamp", label: "Lamp", note: "Warm and soft" },
  { id: "contrast", label: "Contrast", note: "High contrast, strong edges" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "midnight";

const KEY = "codefriends.theme";

const THEME_COLOR: Record<ThemeId, string> = {
  midnight: "#1e1e1e",
  daylight: "#f4f6f8",
  lamp: "#1c1814",
  contrast: "#000000",
};

export function parseThemeId(raw: string | null | undefined): ThemeId {
  return THEMES.some((theme) => theme.id === raw) ? (raw as ThemeId) : DEFAULT_THEME;
}

export function loadTheme(): ThemeId {
  try {
    return parseThemeId(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", id);
  root.style.colorScheme = id === "daylight" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[id]);
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  applyTheme(id);
}
