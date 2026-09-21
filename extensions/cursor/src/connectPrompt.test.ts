import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConnectChoice,
  buildPopoutUrl,
  CONNECT_SNOOZE_MS,
  connectPromptMessage,
  decideConnectPrompt,
  resolveIdeProvider,
} from "./connectPrompt.ts";

test("extension first run → prompt", () => {
  assert.equal(decideConnectPrompt({ hasSession: false, dontAskAgain: false, snoozeUntil: 0 }), "prompt");
});

test("extension already connected → skip", () => {
  assert.equal(decideConnectPrompt({ hasSession: true, dontAskAgain: false }), "skip-connected");
});

test("extension Don't ask again → skip forever", () => {
  const next = applyConnectChoice({ dontAskAgain: false, snoozeUntil: 0 }, "dont-ask", 10);
  assert.equal(decideConnectPrompt({ hasSession: false, ...next }, 99_999_999_999), "skip-dont-ask");
});

test("extension Not now → skip, then prompt after cooldown", () => {
  const now = 1_000;
  const next = applyConnectChoice({ dontAskAgain: false, snoozeUntil: 0 }, "not-now", now);
  assert.equal(decideConnectPrompt({ hasSession: false, ...next }, now + 1), "skip-snoozed");
  assert.equal(decideConnectPrompt({ hasSession: false, ...next }, now + CONNECT_SNOOZE_MS + 1), "prompt");
});

test("extension Connect opens provider=cursor URL and does not claim Cursor SSO", () => {
  const url = buildPopoutUrl({ popoutUrl: "http://127.0.0.1:5173", provider: "cursor" });
  assert.match(url, /provider=cursor/);
  assert.doesNotMatch(connectPromptMessage("cursor"), /Cursor SSO|Sign in with Cursor/);
  assert.match(connectPromptMessage("cursor"), /not Cursor’s own account login screen/);
});

test("extension can hand off to the desktop shell via codefriends://", () => {
  const url = buildPopoutUrl({
    popoutUrl: "codefriends://open",
    provider: "cursor",
    handoff: "abc",
  });
  assert.match(url, /^codefriends:\/\/open/);
  assert.match(url, /provider=cursor/);
  assert.match(url, /handoff=abc/);
});

test("extension auto provider: Cursor vs VSCodium", () => {
  assert.equal(resolveIdeProvider("Cursor", "auto"), "cursor");
  assert.equal(resolveIdeProvider("VSCodium", "auto"), "generic");
});
