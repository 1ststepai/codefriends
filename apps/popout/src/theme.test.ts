import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_THEME, parseThemeId, THEMES } from "./theme.ts";

test("unknown stored theme falls back to midnight", () => {
  assert.equal(parseThemeId(null), "midnight");
  assert.equal(parseThemeId("disco"), DEFAULT_THEME);
});

test("curated themes parse", () => {
  for (const theme of THEMES) assert.equal(parseThemeId(theme.id), theme.id);
});
