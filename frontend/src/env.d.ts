/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly DEV: boolean;
  readonly BASE_URL: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
