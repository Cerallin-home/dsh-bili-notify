# dsh-bili-notify

A DeepSeek Harness plugin that reads the parts of bilibili the video plugin cannot see: **@ mentions**, **replies to your comments**, and **the comment section under a video**. It can also post a comment back, but only as an explicit tool call.

Anonymous mode reads public video comments. Account-scoped reads (@, replies, unread counters) need a full login cookie — `SESSDATA` plus `bili_jct`.

## Tools

| Tool | What it does |
|---|---|
| `bili_notify_unread` | Unread counters: replies, @, likes, system messages |
| `bili_mentions` | "@我的" feed, newest first, with author and target |
| `bili_replies` | "回复我的" feed, including what the person replied to |
| `bili_comments` | One page of a video's comments, by bvid or aid |
| `bili_comment_reply` | Post a comment or a nested reply (writes to the account) |

## Install

```bash
cd ~/.dsh/profiles/<profile>
dsh plugin add /absolute/path/to/dsh-bili-notify
```

Then restart DSH so the new module generation loads.

## Cookie

Put the bare token into your DSH_HOME `.env`, or supply `cookie` in the plugin config:

```
BILIBILI_SESSDATA=<sessdata>; bili_jct=<csrf>
```

Passing the whole `a=b; c=d` string works — the client parses out `SESSDATA` and `bili_jct` itself.

## Config

| Key | Default | Meaning |
|---|---|---|
| `cookieEnv` | `BILIBILI_SESSDATA` | Environment variable holding the cookie |
| `cookie` | — | Literal cookie string, overrides `cookieEnv` |
| `requestTimeoutMs` | `30000` | Per-request timeout |
| `timeoutMs` | `30000` | Cooperative tool-call budget |
| `maxFeedRows` | `50` | Ceiling on rows returned by one feed call |

This plugin only reads. It never uploads, never stores videos, and never touches direct messages.

## 凭据

放在 `~/.dsh/credentials/bili-notify.env`（目录 0700、文件 0600，KEY=VALUE），只此一份。
本插件用的键：`BILIBILI_SESSDATA`。

插件配置里只写 `credentialFile` 指过去，仓库和 patch 都不留明文。
老的两行格式与纯文本令牌仍然兼容，配置指向的文件失效时回退到上面这份。
