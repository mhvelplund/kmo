import { X509Certificate, createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeAddress, makeWebhookKeys } from "../src/keys";

const HOST = "pepr-kmo.pepr-system.svc";
const NOW = new Date("2026-10-11T12:00:00Z");

describe("a webhook key", () => {
  const keys = makeWebhookKeys(HOST, 90, NOW);
  const authority = new X509Certificate(keys.ca);
  const certificate = new X509Certificate(keys.certificate);

  it("has a certificate for the name of the webhook's Service", () => {
    expect(certificate.checkHost(HOST)).toBe(HOST);
  });

  it("has a certificate that its authority signed", () => {
    expect(authority.ca).toBe(true);
    expect(certificate.ca).toBe(false);
    expect(certificate.verify(authority.publicKey)).toBe(true);
  });

  it("has the private key of that certificate, in the form that Pepr writes", () => {
    expect(keys.key).toContain("BEGIN RSA PRIVATE KEY");
    expect(certificate.checkPrivateKey(createPrivateKey(keys.key))).toBe(true);
  });

  it("is valid from an hour before now, for the number of days asked for", () => {
    expect(new Date(certificate.validFrom).toISOString()).toBe("2026-10-11T11:00:00.000Z");
    expect(new Date(certificate.validTo).toISOString()).toBe("2027-01-09T12:00:00.000Z");
    expect(new Date(authority.validTo).toISOString()).toBe("2027-01-09T12:00:00.000Z");
  });

  it("is different each time", () => {
    expect(makeWebhookKeys(HOST, 90, NOW).key).not.toBe(keys.key);
  });
});

describe("an address", () => {
  it("is 64 hexadecimal characters, as Pepr makes it", () => {
    expect(makeAddress()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is different each time", () => {
    expect(makeAddress()).not.toBe(makeAddress());
  });
});
