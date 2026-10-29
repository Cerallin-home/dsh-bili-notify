/**
 * dsh-bili-notify: read the parts of bilibili that the video plugin cannot see —
 * @ mentions, replies, and the comment section under a video — and (only when
 * asked) post a comment back.
 *
 * Anonymous by default: public video comments work without a cookie. Everything
 * account-scoped needs SESSDATA + bili_jct, read from the environment variable
 * named by `cookieEnv` (or `cookie` in config).
 */
import z from '@deepseek-ai/schemastery';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BiliNotifyClient, DEFAULT_USER_AGENT } from './api.js';
import {
  applyCommentsTool,
  applyFeedTools,
  applyReplyTool,
  applyUnreadTool,
} from './tools.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-bili-notify';

/** Services required before the plugin starts. */
export const inject = ['tools', 'systemPrompt'];

/** Environment variable naming the bilibili session cookie. */
export const DEFAULT_COOKIE_ENV = 'BILIBILI_SESSDATA';

/** Default cooperative tool-call budget (ms). */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/** Worst-case rows a single feed call may return. */
export const MAX_FEED_ROWS = 50;

export const Config = z.object({
  cookie: z.string().role('secret'),
  cookieEnv: z.string().default(DEFAULT_COOKIE_ENV),
  userAgent: z.string(),
  requestTimeoutMs: z.number().min(1).default(DEFAULT_TOOL_TIMEOUT_MS),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TOOL_TIMEOUT_MS),
  maxFeedRows: z.number().step(1).min(1).default(MAX_FEED_ROWS),
});

/** @param {unknown} value @returns {string | undefined} */
function configured(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Accept both a full Cookie header and the bare SESSDATA token people tend to
 * paste into `.env`. A bare token has no `=` in it, so that is the tell.
 * @param {string} raw
 */
export function normalizeCookie(raw) {
  const text = raw.trim();
  if (text.length === 0) return text;
  if (/SESSDATA\s*=/.test(text)) return text;
  // Extra pairs pasted alongside the token still need their own names.
  return `SESSDATA=${text}`;
}

/** Where the desktop Firefox snap keeps its cookie jar. */
export const FIREFOX_COOKIES =
  '/home/julia/snap/firefox/common/.mozilla/firefox/apzsvlo9.default/cookies.sqlite';

/**
 * Pull the live `.bilibili.com` cookies out of the Firefox profile. This is the
 * freshest source available: SESSDATA gets rotated as she browses, while a
 * `.env` copy goes stale within days.
 * @param {string} [dbPath]
 * @returns {string} a Cookie header value, or '' when unreadable
 */
export function readFirefoxCookie(dbPath = FIREFOX_COOKIES) {
  const tmp = path.join(os.tmpdir(), `dsh-bili-notify-${process.pid}.sqlite`);
  try {
    fs.copyFileSync(dbPath, tmp);
    const db = new DatabaseSync(tmp, { readOnly: true });
    try {
      const rows = db
        .prepare("select name, value from moz_cookies where host like '%bilibili.com'")
        .all();
      return rows.map((row) => `${row.name}=${row.value}`).join('; ');
    } finally {
      db.close();
    }
  } catch {
    return '';
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

const GUIDANCE =
  'bili_notify_unread / bili_mentions / bili_replies read the bilibili account\'s notifications (mentioned-in and replied-to), ' +
  'and bili_comments reads a video\'s comment section by bvid. They need SESSDATA for account-scoped reads; public comments work anonymously. ' +
  'bili_comment_reply posts a comment to the logged-in account — call it only when the human explicitly asked to reply.';

/**
 * Register the client, the system-prompt guidance and the five tools.
 * @param {any} ctx cordis context
 * @param {any} config schemastery-defaulted plugin config
 */
export function apply(ctx, config) {
  const literalCookie = configured(config.cookie);
  const cookieEnvName = configured(config.cookieEnv) ?? DEFAULT_COOKIE_ENV;
  const envCookie = configured(process.env[cookieEnvName]);

  // Prefer the live Firefox jar: it is the only source that carries both
  // SESSDATA and bili_jct, and it tracks SESSDATA rotation.
  const firefoxCookie = configured(readFirefoxCookie());
  const raw = literalCookie ?? firefoxCookie ?? envCookie;

  const client = new BiliNotifyClient({
    ...(raw === undefined ? {} : { cookie: normalizeCookie(raw) }),
    userAgent: configured(config.userAgent) ?? DEFAULT_USER_AGENT,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  if (!client.authenticated) {
    // Anonymous is a supported mode, but say so once — silence reads as "broken".
    ctx.logger?.('bili-notify')?.info?.(
      `没有找到可用的 SESSDATA（Firefox cookie 库与 env ${cookieEnvName} 都拿不到），只启用公开视频评论`,
    );
  }

  ctx.systemPrompt.section({
    name: 'tool:bili-notify',
    order: 112,
    text: GUIDANCE,
  });

  const maxFeedRows = config.maxFeedRows;
  ctx.tools.register(applyUnreadTool(client, config.timeoutMs));
  for (const tool of applyFeedTools(client, config.timeoutMs, maxFeedRows)) {
    ctx.tools.register(tool);
  }
  ctx.tools.register(applyCommentsTool(client, config.timeoutMs));
  ctx.tools.register(applyReplyTool(client, config.timeoutMs));
}
