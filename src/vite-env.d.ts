/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev tests: which demo to run (see src/debug.ts). */
  readonly VITE_PET_DEMO?: string;
  /** Dev: wear this skin id instead of the one in settings.json. */
  readonly VITE_PET_SKIN?: string;
  /** Dev: skin package the "skin" demo installs. */
  readonly VITE_PET_SKIN_ZIP?: string;
}
