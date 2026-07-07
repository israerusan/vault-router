export interface LicenseVerification {
  valid: boolean;
  email?: string;
  error?: string;
}

export declare function verifyLicense(
  licenseKey: string,
  product: string,
  publicKeyB64: string
): LicenseVerification;
