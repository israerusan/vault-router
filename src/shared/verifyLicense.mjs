import nacl from "tweetnacl";

export function verifyLicense(licenseKey, product, publicKeyB64) {
  const trimmed = String(licenseKey ?? "").trim();
  if (!trimmed) return { valid: false, error: "No license key provided." };

  const parts = trimmed.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Invalid license format." };
  }

  try {
    const payloadBytes = base64ToBytes(parts[0]);
    const signature = base64ToBytes(parts[1]);
    const publicKey = base64ToBytes(publicKeyB64);

    if (!nacl.sign.detached.verify(payloadBytes, signature, publicKey)) {
      return { valid: false, error: "Invalid license signature." };
    }

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (payload.product !== product) {
      return { valid: false, error: "This key is not for Vault Router Pro." };
    }

    return { valid: true, email: payload.email };
  } catch {
    return { valid: false, error: "Could not parse license key." };
  }
}

function base64ToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
