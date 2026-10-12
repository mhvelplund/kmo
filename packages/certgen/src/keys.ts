import { randomBytes } from "node:crypto";
import forge from "node-forge";

/** The PEM texts of one webhook key. */
export interface WebhookKeys {
  /** The certificate of the authority that signed the webhook's certificate. */
  ca: string;
  /** The certificate of the webhook. */
  certificate: string;
  /** The private key of the webhook. */
  key: string;
}

const AUTHORITY = [{ name: "commonName", value: "KMO webhook CA" }];
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function blank(publicKey: forge.pki.PublicKey, from: Date, until: Date): forge.pki.Certificate {
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = publicKey;
  // A leading 01 keeps the serial number positive.
  certificate.serialNumber = `01${randomBytes(15).toString("hex")}`;
  certificate.validity.notBefore = from;
  certificate.validity.notAfter = until;
  certificate.setIssuer(AUTHORITY);
  return certificate;
}

/**
 * Makes an authority and a certificate that it signed, for one webhook.
 * @param host The DNS name of the webhook's Service.
 * @param days The number of days that both certificates are valid.
 * @param now The moment of issue.
 * @returns The authority, the certificate and the private key, as PEM.
 */
export function makeWebhookKeys(host: string, days: number, now: Date = new Date()): WebhookKeys {
  const from = new Date(now.getTime() - HOUR_MS);
  const until = new Date(now.getTime() + days * DAY_MS);

  const authorityKeys = forge.pki.rsa.generateKeyPair(2048);
  const authority = blank(authorityKeys.publicKey, from, until);
  authority.setSubject(AUTHORITY);
  authority.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, critical: true },
  ]);
  authority.sign(authorityKeys.privateKey, forge.md.sha256.create());

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = blank(keys.publicKey, from, until);
  certificate.setSubject([{ name: "commonName", value: host }]);
  certificate.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: host }] },
  ]);
  certificate.sign(authorityKeys.privateKey, forge.md.sha256.create());

  return {
    ca: forge.pki.certificateToPem(authority),
    certificate: forge.pki.certificateToPem(certificate),
    key: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/**
 * Makes the secret part of the webhook's address.
 * @returns 64 hexadecimal characters.
 */
export function makeAddress(): string {
  return randomBytes(32).toString("hex");
}
