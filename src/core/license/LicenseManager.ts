import { verifyLicense } from "../../shared/verifyLicense.mjs";
import { LICENSE_PUBLIC_KEY } from "./publicKey";
import { PRODUCT_ID } from "../../product";

export class LicenseManager {
  static verify(licenseKey: string) {
    return verifyLicense(licenseKey, PRODUCT_ID, LICENSE_PUBLIC_KEY);
  }
}
