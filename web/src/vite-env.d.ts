/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_SIP_WSS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
