/**
 * Thin bilibili HTTP client for the notification/comment surface.
 *
 * Everything here is a read except `replyComment`, which posts a comment and
 * therefore needs both SESSDATA (identity) and bili_jct (CSRF token).
 */

/** Canonical desktop UA; bilibili answers differently to unknown agents. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Error whose message is safe to show the model verbatim. */
export class BiliNotifyError extends Error {
  /**
   * @param {string} message human-readable reason
   * @param {{ code?: number, status?: number }} [extra] bilibili code / HTTP status
   */
  constructor(message, extra = {}) {
    super(message);
    this.name = 'BiliNotifyError';
    this.code = extra.code;
    this.status = extra.status;
  }
}

/** Parse a Cookie header string into a name→value map. */
export function parseCookieHeader(header) {
  const map = new Map();
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return map;
}

/**
 * The bilibili side of the plugin: one cookie jar string, fixed UA, JSON only.
 */
export class BiliNotifyClient {
  /**
   * @param {{ cookie?: string, userAgent?: string, requestTimeoutMs?: number }} options
   */
  constructor(options = {}) {
    this.cookie = options.cookie ?? '';
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.jars = parseCookieHeader(this.cookie);
  }

  /** True when a SESSDATA was supplied, i.e. account-scoped reads may work. */
  get authenticated() {
    return this.jars.has('SESSDATA');
  }

  /** The CSRF token bilibili wants on every write. */
  get csrf() {
    const token = this.jars.get('bili_jct');
    if (!token) throw new BiliNotifyError('缺少 bili_jct，无法进行写操作（需要完整登录 cookie）');
    return token;
  }

  /**
   * One JSON GET/POST.
   * @param {string} url absolute URL
   * @param {{ method?: string, body?: URLSearchParams, referer?: string, signal?: AbortSignal }} [init]
   */
  async request(url, init = {}) {
    const headers = {
      'User-Agent': this.userAgent,
      Accept: 'application/json, text/plain, */*',
      Referer: init.referer ?? 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com',
    };
    if (this.cookie) headers.Cookie = this.cookie;
    if (init.body) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const signals = [AbortSignal.timeout(this.requestTimeoutMs)];
    if (init.signal) signals.push(init.signal);

    let response;
    try {
      response = await fetch(url, {
        method: init.method ?? 'GET',
        headers,
        ...(init.body ? { body: init.body.toString() } : {}),
        signal: AbortSignal.any(signals),
      });
    } catch (cause) {
      if (cause?.name === 'TimeoutError') {
        throw new BiliNotifyError(`请求超时（${this.requestTimeoutMs} ms）: ${url}`);
      }
      throw new BiliNotifyError(`请求失败: ${/** @type {Error} */ (cause).message}`);
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new BiliNotifyError(`返回的不是 JSON（HTTP ${response.status}）: ${text.slice(0, 120)}`, {
        status: response.status,
      });
    }
    if (payload?.code !== 0) {
      const code = Number(payload?.code);
      throw new BiliNotifyError(
        `${describeCode(code, payload?.message)} [code ${code}]`,
        { code, status: response.status },
      );
    }
    return payload.data;
  }

  /** Unread counters for @ / reply / comment / dm, from the IM endpoint. */
  async unread() {
    this.#requireLogin('unread');
    const data = await this.request('https://api.vc.bilibili.com/x/im/web/msgfeed/unread', {
      referer: 'https://message.bilibili.com/',
    });
    const counts = data?.counts ?? data ?? {};
    return {
      reply: Number(counts.reply ?? 0),
      at: Number(counts.at ?? 0),
      like: Number(counts.like ?? 0),
      sysMsg: Number(counts.sys_msg ?? 0),
      raw: counts,
    };
  }

  /**
   * One page of "回复我的".
   * @param {{ cursorId?: number, cursorTime?: number, limit?: number, signal?: AbortSignal }} [page]
   */
  async replyFeed(page = {}) {
    this.#requireLogin('replyFeed');
    const params = new URLSearchParams({
      platform: 'web',
      build: '0',
      mobi_app: 'web',
    });
    if (page.cursorId) params.set('id', String(page.cursorId));
    if (page.cursorTime) params.set('reply_time', String(page.cursorTime));
    const data = await this.request(`https://api.bilibili.com/x/msgfeed/reply?${params}`, {
      referer: 'https://message.bilibili.com/',
      signal: page.signal,
    });
    const items = (data?.items ?? []).slice(0, page.limit ?? undefined);
    return {
      items,
      cursor: {
        id: Number(data?.cursor?.id ?? 0),
        time: Number(data?.cursor?.time ?? 0),
        isEnd: Boolean(data?.cursor?.is_end ?? true),
      },
    };
  }

  /**
   * One page of "@我的".
   * @param {{ cursorId?: number, cursorTime?: number, limit?: number, signal?: AbortSignal }} [page]
   */
  async atFeed(page = {}) {
    this.#requireLogin('atFeed');
    const params = new URLSearchParams({
      platform: 'web',
      build: '0',
      mobi_app: 'web',
    });
    if (page.cursorId) params.set('id', String(page.cursorId));
    if (page.cursorTime) params.set('reply_time', String(page.cursorTime));
    const data = await this.request(`https://api.bilibili.com/x/msgfeed/at?${params}`, {
      referer: 'https://message.bilibili.com/',
      signal: page.signal,
    });
    const items = (data?.items ?? []).slice(0, page.limit ?? undefined);
    return {
      items,
      cursor: {
        id: Number(data?.cursor?.id ?? 0),
        time: Number(data?.cursor?.time ?? 0),
        isEnd: Boolean(data?.cursor?.is_end ?? true),
      },
    };
  }

  /**
   * bvid → aid, because the comment API speaks aid.
   * @param {string} bvid
   * @param {AbortSignal} [signal]
   */
  async aidOf(bvid, signal) {
    const data = await this.request(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      { signal },
    );
    const aid = Number(data?.aid ?? 0);
    if (!aid) throw new BiliNotifyError(`拿不到 ${bvid} 的 aid`);
    return { aid, title: String(data?.title ?? ''), commentCount: Number(data?.stat?.reply ?? 0) };
  }

  /**
   * One page of a video's comments.
   * @param {{ oid: number, pn?: number, ps?: number, sort?: string, signal?: AbortSignal }} query
   */
  async comments(query) {
    const params = new URLSearchParams({
      type: '1',
      oid: String(query.oid),
      pn: String(query.pn ?? 1),
      ps: String(query.ps ?? 20),
      sort: String(query.sort ?? '2'),
    });
    const data = await this.request(`https://api.bilibili.com/x/v2/reply?${params}`, {
      signal: query.signal,
    });
    const replies = (data?.replies ?? []).map(flattenReply);
    return {
      page: Number(data?.page?.num ?? query.pn ?? 1),
      pageSize: Number(data?.page?.size ?? query.ps ?? 20),
      total: Number(data?.page?.count ?? replies.length),
      items: replies,
    };
  }

  /**
   * Post a comment (or a reply under an existing comment).
   * @param {{ oid: number, message: string, root?: number, parent?: number, signal?: AbortSignal }} input
   */
  async replyComment(input) {
    const body = new URLSearchParams({
      oid: String(input.oid),
      type: '1',
      message: input.message,
      csrf: this.csrf,
      plat: '1',
    });
    if (input.root) body.set('root', String(input.root));
    if (input.parent) body.set('parent', String(input.parent));
    const data = await this.request('https://api.bilibili.com/x/v2/reply/add', {
      method: 'POST',
      body,
      referer: `https://www.bilibili.com/video/av${input.oid}`,
      signal: input.signal,
    });
    return { rpid: Number(data?.rpid ?? 0), message: String(data?.message ?? '') };
  }

  /** @param {string} what */
  #requireLogin(what) {
    if (!this.authenticated) {
      throw new BiliNotifyError(`读取「${what}」需要登录：没有配置 SESSDATA，只能看公开视频评论`);
    }
  }
}

/**
 * Shrink one raw comment item to the fields worth putting in front of a model.
 * @param {any} item
 */
export function flattenReply(item) {
  const member = item?.member ?? {};
  return {
    rpid: Number(item?.rpid ?? 0),
    root: Number(item?.root ?? 0),
    parent: Number(item?.parent ?? 0),
    author: String(member.uname ?? ''),
    authorMid: Number(member.mid ?? 0),
    message: String(item?.content?.message ?? ''),
    like: Number(item?.like ?? 0),
    replyCount: Number(item?.rcount ?? 0),
    createdAt: Number(item?.ctime ?? 0) * 1000,
  };
}

/**
 * Shrink one msgfeed item (reply / at share a shape).
 * @param {any} item
 */
export function flattenFeedItem(item) {
  const user = item?.user ?? {};
  const content = String(item?.item?.source_content ?? item?.item?.title ?? '').slice(0, 400);
  return {
    id: Number(item?.id ?? item?.item?.id ?? 0),
    kind: item?.business_id === 1 ? 'video' : item?.business_id === 12 ? 'comment' : 'other',
    author: String(user.nickname ?? ''),
    authorMid: Number(user.mid ?? 0),
    action: String(item?.item?.business ?? ''),
    text: String(item?.item?.source_content ?? '').slice(0, 400),
    targetTitle: String(item?.item?.title ?? '').slice(0, 120),
    targetUri: String(item?.item?.uri ?? ''),
    myContent: String(item?.item?.target_reply_content ?? '').slice(0, 200),
    createdAt: Number(item?.reply_time ?? item?.at_time ?? 0) * 1000,
    preview: content,
  };
}

/**
 * Turn a bilibili error code into something a human can act on.
 * @param {number} code
 * @param {string} [message]
 */
function describeCode(code, message) {
  const hint = {
    '-101': '账号未登录（cookie 过期或没带 SESSDATA）',
    '-111': 'CSRF 校验失败（bili_jct 不匹配）',
    '-352': '风控校验失败，换个时间再试',
    '-404': '内容不存在或已删除',
    12002: '评论区已关闭',
    12009: '被拉黑，无法评论',
  }[code];
  if (hint) return `${hint}：${message ?? ''}`.trim();
  return message || 'bilibili 返回了错误';
}
