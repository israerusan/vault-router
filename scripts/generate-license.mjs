import fs from "fs";
    import path from "path";
    import nacl from "tweetnacl";
    import { fileURLToPath } from "url";

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

    const email = process.argv[2];
    if (!email) {
      console.error("Usage: npm run license:generate -- customer@email.com");
      process.exit(1);
    }

    if (!fs.existsSync(privateKeyPath)) {
      console.error("Missing scripts/.license-private.key — cannot sign licenses.");
      process.exit(1);
    }

    const secretKey = fromBase64(fs.readFileSync(privateKeyPath, "utf8").trim());
    const payload = { product: "vault-router", email, issued: new Date().toISOString() };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const signature = nacl.sign.detached(payloadBytes, secretKey);
    const licenseKey = `${toBase64(payloadBytes)}.${toBase64(signature)}`;

    console.log("
Vault Router — Pro license
");
    console.log(`Email: ${email}`);
    console.log(`Key:   ${licenseKey}
`);
