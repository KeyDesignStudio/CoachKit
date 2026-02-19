import crypto from 'node:crypto';

function normalizeSignature(raw: string) {
  const trimmed = raw.trim();
  const eq = trimmed.indexOf('=');
  if (eq > 0) return trimmed.slice(eq + 1).trim();
  return trimmed;
}

export function verifyWebhookHmacSha256(params: {
  rawBody: string;
  secret: string;
  signatureHeaderValue: string | null;
}) {
  const { rawBody, secret, signatureHeaderValue } = params;
  if (!signatureHeaderValue) return false;

  const provided = normalizeSignature(signatureHeaderValue);
  if (!provided) return false;

  const digestHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const providedBuf = Buffer.from(provided, 'utf8');
  const digestBuf = Buffer.from(digestHex, 'utf8');

  if (providedBuf.length !== digestBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, digestBuf);
}
