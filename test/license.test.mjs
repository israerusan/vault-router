import assert from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nacl from "tweetnacl";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { verifyLicense } = await import(pathToFileURL(path.join(root, "src", "shared", "verifyLicense.mjs")).href);

const PRODUCT = "vault-router";

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeKey(secretKey, payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = nacl.sign.detached(bytes, secretKey);
  return `${b64url(bytes)}.${b64url(sig)}`;
}

const kp = nacl.sign.keyPair();
const pub = Buffer.from(kp.publicKey).toString("base64");

const good = makeKey(kp.secretKey, { product: PRODUCT, email: "buyer@example.com" });
let r = verifyLicense(good, PRODUCT, pub);
assert.ok(r.valid, "good key should verify");

const wrongProduct = makeKey(kp.secretKey, { product: "nope", email: "x@y.z" });
r = verifyLicense(wrongProduct, PRODUCT, pub);
assert.ok(!r.valid, "wrong product should fail");

const [payloadPart, sigPart] = good.split(".");
const tamperedPayload = b64url(new TextEncoder().encode(JSON.stringify({ product: PRODUCT, email: "evil@example.com" })));
r = verifyLicense(`${tamperedPayload}.${sigPart}`, PRODUCT, pub);
assert.ok(!r.valid, "tampered payload should fail");

const other = nacl.sign.keyPair();
r = verifyLicense(good, PRODUCT, Buffer.from(other.publicKey).toString("base64"));
assert.ok(!r.valid, "wrong public key should fail");

assert.ok(!verifyLicense("", PRODUCT, pub).valid, "empty key rejected");
assert.ok(!verifyLicense(`${payloadPart}.@@@`, PRODUCT, pub).valid, "bad base64 rejected");

console.log("license verification tests passed");
