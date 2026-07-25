// Rotated 2026-07-25. This file previously held Note Doctor's public key, copied
// in when the repo was scaffolded, which meant Vault Router had no signing key of
// its own. Rotating was safe: scripts/generate-license.mjs did not parse until the
// same date, so no Vault Router key had ever been issued to anyone.
export const LICENSE_PUBLIC_KEY = "ex7mw6TGClnLTFXnQUGcpSQmhKWij9aPkvPO2aGqNvQ";
