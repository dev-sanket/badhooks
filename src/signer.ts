import { createHmac } from "node:crypto";

export type StripeSignature = {
  timestamp: number;
  v1: string;
  header: string;
};

export function sign(
  payload: string,
  secret: string,
  timestamp: number,
): StripeSignature {
  const signedPayload = `${timestamp}.${payload}`;
  const v1 = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return {
    timestamp,
    v1,
    header: `t=${timestamp},v1=${v1}`,
  };
}
