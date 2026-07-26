import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sign } from "./signer.ts";

describe("sign", () => {
  const secret = "whsec_test_secret";
  const payload = '{"id":"evt_test_webhook","object":"event"}';
  const timestamp = 1614556800;
  const expectedV1 =
    "96943a0ceebda8d3913e8b90697d39bbe16342f950890d77a41a248e4fb22794";
  const expectedHeader = `t=${timestamp},v1=${expectedV1}`;

  it("produces a known v1 for a known secret, payload, and timestamp", () => {
    const result = sign(payload, secret, timestamp);

    assert.equal(result.timestamp, timestamp);
    assert.equal(result.v1, expectedV1);
    assert.equal(result.header, expectedHeader);
  });

  it("uses the exact payload bytes — whitespace changes the signature", () => {
    const spaced = '{"id": "evt_test_webhook", "object": "event"}';
    const result = sign(spaced, secret, timestamp);

    assert.notEqual(result.v1, expectedV1);
  });

  it("includes the full whsec_ secret in the HMAC key (not base64-decoded)", () => {
    // If someone strips whsec_ and base64-decodes, this vector fails.
    // Cross-check: stripe-node uses the full secret string as the key.
    const result = sign(payload, secret, timestamp);
    assert.equal(
      result.v1,
      "96943a0ceebda8d3913e8b90697d39bbe16342f950890d77a41a248e4fb22794",
    );
  });

  it("changes v1 when timestamp changes", () => {
    const a = sign(payload, secret, timestamp);
    const b = sign(payload, secret, timestamp + 1);
    assert.notEqual(a.v1, b.v1);
    assert.equal(b.header, `t=${timestamp + 1},v1=${b.v1}`);
  });
});
