import crypto from 'node:crypto';

import { ApiError } from '@/lib/errors';

type InviteEmailInput = {
  toEmail: string;
  toName: string;
  inviteLink: string;
  coachName: string;
  squadName: string;
};

type InviteProvider = 'resend' | 'postmark' | 'ses';

type InviteSendResult = {
  provider: InviteProvider;
  messageId: string | null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new ApiError(500, 'EMAIL_PROVIDER_NOT_CONFIGURED', `Missing required environment variable: ${name}.`);
  }
  return value.trim();
}

function resolveProvider(): InviteProvider {
  const forced = String(process.env.INVITE_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  if (forced === 'resend' || forced === 'postmark' || forced === 'ses') return forced;
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.POSTMARK_SERVER_TOKEN) return 'postmark';
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION) return 'ses';
  throw new ApiError(
    500,
    'EMAIL_PROVIDER_NOT_CONFIGURED',
    'No invite email provider configured. Set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or AWS SES credentials.'
  );
}

function buildInviteEmailContent(input: InviteEmailInput) {
  const safeName = input.toName || 'there';
  const subject = `${input.squadName}: You are invited to CoachKit`;
  const text = [
    `Hi ${safeName},`,
    '',
    `${input.coachName} invited you to join CoachKit.`,
    '',
    'Use your personal link to sign up and complete your training request:',
    input.inviteLink,
    '',
    'See you inside,',
    input.coachName,
  ].join('\n');

  const html = [
    `<p>Hi ${safeName},</p>`,
    `<p>${input.coachName} invited you to join CoachKit.</p>`,
    '<p>Use your personal link to sign up and complete your training request:</p>',
    `<p><a href="${input.inviteLink}" target="_blank" rel="noopener noreferrer">${input.inviteLink}</a></p>`,
    `<p>See you inside,<br/>${input.coachName}</p>`,
  ].join('');

  return { subject, text, html };
}

async function sendViaResend(input: InviteEmailInput): Promise<InviteSendResult> {
  const apiKey = requireEnv('RESEND_API_KEY');
  const from = requireEnv('INVITE_EMAIL_FROM');
  const content = buildInviteEmailContent(input);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.toEmail],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(502, 'INVITE_EMAIL_SEND_FAILED', payload?.message || 'Resend invite send failed.');
  }

  return { provider: 'resend', messageId: payload?.id ? String(payload.id) : null };
}

async function sendViaPostmark(input: InviteEmailInput): Promise<InviteSendResult> {
  const token = requireEnv('POSTMARK_SERVER_TOKEN');
  const from = requireEnv('INVITE_EMAIL_FROM');
  const content = buildInviteEmailContent(input);

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: from,
      To: input.toEmail,
      Subject: content.subject,
      TextBody: content.text,
      HtmlBody: content.html,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || 'outbound',
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || (typeof payload?.ErrorCode === 'number' && payload.ErrorCode !== 0)) {
    throw new ApiError(502, 'INVITE_EMAIL_SEND_FAILED', payload?.Message || 'Postmark invite send failed.');
  }

  return {
    provider: 'postmark',
    messageId: payload?.MessageID ? String(payload.MessageID) : null,
  };
}

function hashSha256Hex(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashSha256(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function hmacSha256(key: Buffer | string, value: string) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

function toAmzDate(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    shortDate: iso.slice(0, 8),
  };
}

function signAwsV4(params: {
  region: string;
  service: string;
  host: string;
  path: string;
  method: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}) {
  const now = new Date();
  const { amzDate, shortDate } = toAmzDate(now);
  const canonicalUri = params.path;
  const canonicalQueryString = '';
  const payloadHash = hashSha256Hex(params.body);
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    host: params.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (params.sessionToken) {
    baseHeaders['x-amz-security-token'] = params.sessionToken;
  }

  const signedHeaderKeys = Object.keys(baseHeaders).sort();
  const canonicalHeaders = signedHeaderKeys.map((key) => `${key}:${baseHeaders[key]}`).join('\n') + '\n';
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashSha256Hex(canonicalRequest)].join('\n');

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, shortDate);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, params.service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    headers: {
      ...baseHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function sendViaSes(input: InviteEmailInput): Promise<InviteSendResult> {
  const region = requireEnv('AWS_REGION');
  const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim() || undefined;
  const from = requireEnv('INVITE_EMAIL_FROM');
  const content = buildInviteEmailContent(input);

  const host = `email.${region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const body = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [input.toEmail] },
    Content: {
      Simple: {
        Subject: { Data: content.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: content.text, Charset: 'UTF-8' },
          Html: { Data: content.html, Charset: 'UTF-8' },
        },
      },
    },
    ...(process.env.SES_CONFIGURATION_SET_NAME?.trim()
      ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET_NAME.trim() }
      : {}),
    ...(process.env.SES_REPLY_TO?.trim() ? { ReplyToAddresses: [process.env.SES_REPLY_TO.trim()] } : {}),
  });

  const signed = signAwsV4({
    region,
    service: 'ses',
    host,
    path,
    method: 'POST',
    body,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });

  const response = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: signed.headers,
    body,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const reason =
      payload?.message ||
      payload?.Message ||
      payload?.Error?.Message ||
      payload?.errors?.[0]?.message ||
      'AWS SES invite send failed.';
    throw new ApiError(502, 'INVITE_EMAIL_SEND_FAILED', String(reason));
  }

  return { provider: 'ses', messageId: payload?.MessageId ? String(payload.MessageId) : null };
}

export async function sendTrainingRequestInviteEmail(input: InviteEmailInput): Promise<InviteSendResult> {
  const provider = resolveProvider();
  if (provider === 'resend') return sendViaResend(input);
  if (provider === 'postmark') return sendViaPostmark(input);
  return sendViaSes(input);
}

