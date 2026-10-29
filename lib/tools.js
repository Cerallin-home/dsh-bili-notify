/**
 * The model-facing tools: notification counters, @ feeds, reply feeds, video
 * comments, and posting a comment back.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BiliNotifyError, flattenFeedItem, flattenReply } from './api.js';

/** Accepted bvid shape (BV + 10 alphanumerics). */
export const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

/** Comment sort orders bilibili accepts on the web. */
export const COMMENT_SORTS = ['0', '1', '2'];

/**
 * Seconds → "YYYY-MM-DD HH:mm" in Asia/Shanghai, which is what Julia reads.
 * @param {number} ms
 */
export function formatTime(ms) {
  if (!ms) return '未知时间';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * @param {any} value
 * @returns {string} never-blank text for a text block
 */
function text(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : '—';
}

/**
 * Render a feed page (replies or @) as one compact markdown-ish block.
 * @param {string} heading
 * @param {Array<ReturnType<typeof flattenFeedItem>>} items
 */
export function formatFeed(heading, items) {
  if (items.length === 0) return `${heading}：没有新内容。`;
  const lines = [`${heading}（${items.length} 条）`];
  for (const item of items) {
    lines.push(
      `\n- ${formatTime(item.createdAt)} · ${text(item.author)}（mid ${item.authorMid || '?'}）` +
        `${item.targetTitle ? ' 在《' + text(item.targetTitle) + '》' : ''}`,
    );
    if (item.myContent) lines.push(`  回的是你这条：${text(item.myContent)}`);
    lines.push(`  内容：${text(item.text)}`);
    if (item.targetUri) lines.push(`  链接：${item.targetUri}`);
  }
  return lines.join('\n');
}

/**
 * Render a comment page.
 * @param {{ title?: string, total: number, page: number, items: Array<ReturnType<typeof flattenReply>> }} page
 */
export function formatComments(page) {
  if (page.items.length === 0) return '这一页没有评论。';
  const lines = [
    `${page.title ? '《' + text(page.title) + '》' : '视频'}评论区 · 第 ${page.page} 页 · 共 ${page.total} 条`,
  ];
  for (const c of page.items) {
    lines.push(
      `\n- ${formatTime(c.createdAt)} · ${text(c.author)}（mid ${c.authorMid || '?'}）· 赞 ${c.like} · 回复 ${c.replyCount}`,
    );
    lines.push(`  rpid ${c.rpid}${c.parent ? ` / parent ${c.parent}` : ''}`);
    lines.push(`  内容：${text(c.message)}`);
  }
  return lines.join('\n');
}

/**
 * Register `bili_notify_unread`.
 * @param {import('./api.js').BiliNotifyClient} client
 * @param {number} timeoutMs
 */
export function applyUnreadTool(client, timeoutMs) {
  return defineTool({
    name: 'bili_notify_unread',
    description:
      'Read bilibili unread counters for the logged-in account: replies, @ mentions, likes and system messages. Use it as the cheap "is there anything waiting" check before pulling whole feeds.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reply: { type: 'number', required: true },
          at: { type: 'number', required: true },
          like: { type: 'number', required: true },
          sysMsg: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `未读：回复 ${value.reply} · @ ${value.at} · 点赞 ${value.like} · 系统 ${value.sysMsg}`,
        },
      ],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const counts = await client.unread();
      return { reply: counts.reply, at: counts.at, like: counts.like, sysMsg: counts.sysMsg };
    },
  });
}

/**
 * Register `bili_mentions` (@ my) and `bili_replies` (reply my).
 * @param {import('./api.js').BiliNotifyClient} client
 * @param {number} timeoutMs
 * @param {number} maxLimit
 */
export function applyFeedTools(client, timeoutMs, maxLimit) {
  /** @param {'at' | 'reply'} kind */
  const build = (kind) =>
    defineTool({
      name: kind === 'at' ? 'bili_mentions' : 'bili_replies',
      description:
        kind === 'at'
          ? 'List recent bilibili "@我的" notifications (people who @-mentioned the logged-in account), newest first. Each row carries the author, the sentence that mentions you, the target title and a URL.'
          : 'List recent bilibili "回复我的" notifications (replies to the account\'s comments and videos), newest first, including what the person was replying to.',
      parameters: {
        limit: {
          type: 'number',
          description: `How many rows to return (1-${maxLimit}, default 10). Only the first page is read.`,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'number', required: true },
                  author: { type: 'string', required: true },
                  authorMid: { type: 'number', required: true },
                  text: { type: 'string', required: true },
                  targetTitle: { type: 'string', required: true },
                  targetUri: { type: 'string', required: true },
                  myContent: { type: 'string', required: true },
                  createdAt: { type: 'number', required: true },
                },
              },
            },
            hasMore: { type: 'boolean', required: true },
          },
        },
        render: (args, value) => [
          {
            type: 'text',
            text: formatFeed(
              kind === 'at' ? '提到我的' : '回复我的',
              value.items.map((item) => item),
            ),
          },
        ],
      },
      timeoutMs,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const requested = Number(args.limit ?? 10);
        const limit = Number.isFinite(requested)
          ? Math.min(Math.max(Math.trunc(requested), 1), maxLimit)
          : 10;
        const page = kind === 'at'
          ? await client.atFeed({ limit, signal: exec.signal })
          : await client.replyFeed({ limit, signal: exec.signal });
        // Keep only the declared schema fields: the output validator rejects extras.
        const items = page.items.map(flattenFeedItem).map((item) => ({
          id: item.id,
          author: item.author,
          authorMid: item.authorMid,
          text: item.text,
          targetTitle: item.targetTitle,
          targetUri: item.targetUri,
          myContent: item.myContent,
          createdAt: item.createdAt,
        }));
        return { items, hasMore: !page.cursor.isEnd };
      },
    });

  return [build('at'), build('reply')];
}

/**
 * Register `bili_comments`.
 * @param {import('./api.js').BiliNotifyClient} client
 * @param {number} timeoutMs
 */
export function applyCommentsTool(client, timeoutMs) {
  return defineTool({
    name: 'bili_comments',
    description:
      'Read the comment section under one bilibili video. Accepts a bvid (BV…) or a numeric aid; returns the comment rows with author, like count and rpid, plus the page totals.',
    parameters: {
      bvid: { type: 'string', description: 'Video bvid, e.g. BV11Cso6iExA.' },
      aid: { type: 'number', description: 'Numeric aid, alternative to bvid.' },
      page: { type: 'number', description: '1-based comment page. Defaults to 1.' },
      pageSize: { type: 'number', description: 'Rows per page (1-50, default 20).' },
      sort: {
        type: 'string',
        enum: [...COMMENT_SORTS],
        description: 'Sort: 0 = time, 1 = like count, 2 = hot (default).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          aid: { type: 'number', required: true },
          title: { type: 'string', required: true },
          total: { type: 'number', required: true },
          page: { type: 'number', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rpid: { type: 'number', required: true },
                root: { type: 'number', required: true },
                parent: { type: 'number', required: true },
                author: { type: 'string', required: true },
                authorMid: { type: 'number', required: true },
                message: { type: 'string', required: true },
                like: { type: 'number', required: true },
                replyCount: { type: 'number', required: true },
                createdAt: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: formatComments({ ...value, title: value.title }) },
      ],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const bvid = typeof args.bvid === 'string' ? args.bvid.trim() : '';
      const numericAid = Number(args.aid ?? 0);
      let aid = numericAid > 0 ? numericAid : 0;
      let title = '';
      if (!aid) {
        if (!BVID_PATTERN.test(bvid)) {
          throw new BiliNotifyError('需要 bvid（形如 BV11Cso6iExA）或数字 aid');
        }
        const resolved = await client.aidOf(bvid, exec.signal);
        aid = resolved.aid;
        title = resolved.title;
      }
      const rawPage = Number(args.page ?? 1);
      const rawSize = Number(args.pageSize ?? 20);
      const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
      const pageSize = Number.isFinite(rawSize) ? Math.min(Math.max(Math.trunc(rawSize), 1), 50) : 20;
      const sort = COMMENT_SORTS.includes(String(args.sort)) ? String(args.sort) : '2';
      const result = await client.comments({ oid: aid, pn: page, ps: pageSize, sort, signal: exec.signal });
      return { aid, title, total: result.total, page: result.page, items: result.items };
    },
  });
}

/**
 * Register `bili_comment_reply` — the only writing tool in this plugin.
 * @param {import('./api.js').BiliNotifyClient} client
 * @param {number} timeoutMs
 */
export function applyReplyTool(client, timeoutMs) {
  return defineTool({
    name: 'bili_comment_reply',
    description:
      'Post a comment on a bilibili video, or reply under an existing comment. Writes to the logged-in account: only call it when the human explicitly asked to reply. Returns the new rpid.',
    parameters: {
      bvid: { type: 'string', description: 'Video bvid; required unless aid is given.' },
      aid: { type: 'number', description: 'Numeric aid, alternative to bvid.' },
      message: { type: 'string', required: true, description: 'The comment text to post.' },
      root: { type: 'number', description: 'Top-level comment rpid to answer (for a nested reply).' },
      parent: { type: 'number', description: 'The exact comment rpid being answered.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rpid: { type: 'number', required: true },
          url: { type: 'string', required: true },
        },
      },
      render: (args, value) => [
        {
          type: 'text',
          text: value.rpid > 0
            ? `已发出，rpid ${value.rpid}：${args.message.slice(0, 80)}`
            : '发送了，但 bilibili 没返回 rpid（可能在审核）',
        },
      ],
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const message = String(args.message ?? '').trim();
      if (!message) throw new BiliNotifyError('message 不能为空');
      const numericAid = Number(args.aid ?? 0);
      const bvid = typeof args.bvid === 'string' ? args.bvid.trim() : '';
      let aid = numericAid > 0 ? numericAid : 0;
      if (!aid) {
        if (!BVID_PATTERN.test(bvid)) throw new BiliNotifyError('需要 bvid 或 aid');
        aid = (await client.aidOf(bvid, exec.signal)).aid;
      }
      const root = Number(args.root ?? 0) || undefined;
      const parent = Number(args.parent ?? 0) || undefined;
      const result = await client.replyComment({ oid: aid, message, root, parent, signal: exec.signal });
      return { rpid: result.rpid, url: `https://www.bilibili.com/video/av${aid}` };
    },
  });
}
