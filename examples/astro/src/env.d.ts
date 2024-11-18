/// <reference path="../.astro/types.d.ts" />
interface ImportMetaEnv {
  readonly QSTASH_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
