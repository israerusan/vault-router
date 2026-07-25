// Author-only tool. Requires scripts/.license-private.key (never commit or publish).
//   npm run license:generate -- customer@email.com
//
// Prefer the licensing Worker (POST /admin/issue) for real sales — it records the
// purchase and emails the customer. This stays for offline use and comp keys.
import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import { fileURLToPath } from "url";

import { LICENSE_PUBLIC_KEY } from "../src/core/license/publicKey.ts";

const PRODUCT = "vault-router";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const privateKeyPath = path.join(__dirname, ".license-private.key");

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

const email = String(process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run license:generate -- customer@email.com");
  process.exit(1);
}

if (!fs.existsSync(privateKeyPath)) {
  console.error("Missing scripts/.license-private.key — cannot sign licenses.");
  process.exit(1);
}

const secretKey = fromBase64(fs.readFileSync(privateKeyPath, "utf8").trim());
if (secretKey.length !== nacl.sign.secretKeyLength) {
  console.error(`scripts/.license-private.key decodes to ${secretKey.length} bytes, expected ${nacl.sign.secretKeyLength}.`);
  process.exit(1);
}

const payload = { product: PRODUCT, email, issued: new Date().toISOString() };
const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
const signature = nacl.sign.detached(payloadBytes, secretKey);
const licenseKey = `${toBase64(payloadBytes)}.${toBase64(signature)}`;

// Verify against the public key that actually SHIPS, before printing a key the
// author would paste into an email. If the private key on this machine is ever
// replaced or restored from a stale backup, fail loudly instead of handing a
// paying customer a key that verifies nowhere.
const publicKey = fromBase64(LICENSE_PUBLIC_KEY);
if (!nacl.sign.detached.verify(payloadBytes, signature, publicKey)) {
  console.error("\nREFUSING TO ISSUE THIS KEY — it does not verify against the shipped public key.");
  console.error("scripts/.license-private.key does not match LICENSE_PUBLIC_KEY in src/core/license/publicKey.ts.");
  console.error("Do NOT regenerate the keypair to work around this: that revokes Pro for everyone who has paid.");
  process.exit(1);
}

console.log("\nVault Router — Pro license\n");
console.log(`Email: ${email}`);
console.log(`Key:   ${licenseKey}\n`);
console.log("Verified against the shipped public key.\n");
