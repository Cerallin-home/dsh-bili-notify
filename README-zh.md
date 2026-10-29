# dsh-bili-notify

给 DeepSeek Harness 用的 B 站通知插件：读 **@我的**、**回复我的**、**视频评论区**。也能回一条评论，但只有显式调用工具才会动手。

匿名模式只能看公开视频的评论；@、回复和未读数要完整登录 cookie——`SESSDATA` 加 `bili_jct`。

## 工具

| 工具 | 作用 |
|---|---|
| `bili_notify_unread` | 未读数：回复、@、点赞、系统消息 |
| `bili_mentions` | "@我的" 列表，新的在前，带作者和来源 |
| `bili_replies` | "回复我的" 列表，带对方回的是哪条 |
| `bili_comments` | 某个视频的一页评论，收 bvid 或 aid |
| `bili_comment_reply` | 发评论或楼中楼回复（会写账号） |

## 安装

```bash
cd ~/.dsh/profiles/<profile>
dsh plugin add /home/julia/fatfish/plugins/dsh-bili-notify
```

装完重启 DSH 才会载入新模块。

## Cookie

写进 DSH_HOME 的 `.env`，或者直接给插件配置 `cookie`：

```
BILIBILI_SESSDATA=<sessdata>; bili_jct=<csrf>
```

整串 `a=b; c=d` 也可以，客户端自己拆 `SESSDATA` 和 `bili_jct`。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `cookieEnv` | `BILIBILI_SESSDATA` | 存 cookie 的环境变量名 |
| `cookie` | — | 直接给 cookie 字符串，优先于 `cookieEnv` |
| `requestTimeoutMs` | `30000` | 单请求超时 |
| `timeoutMs` | `30000` | 工具调用预算 |
| `maxFeedRows` | `50` | 单次 feed 最多返回几条 |

只读。不上传、不存视频、不碰私信。
