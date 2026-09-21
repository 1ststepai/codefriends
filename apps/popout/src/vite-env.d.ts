/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CODEFRIENDS_API_URL?: string;
  readonly VITE_CODEFRIENDS_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Injected by the Tauri desktop shell for packaged builds. */
  __CODEFRIENDS_API_URL__?: string;
  __CODEFRIENDS_WS_URL__?: string;
}
