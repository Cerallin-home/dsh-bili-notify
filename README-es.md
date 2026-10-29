# dsh-bili-notify

A DeepSeek Harness plugin that reads bilibili @ mentions, replies and video comments.

## Tools

| Tool | What it does |
|---|---|
| `bili_notify_unread` | Contadores sin leer |
| `bili_mentions` | Feed de @menciones |
| `bili_replies` | Feed de respuestas |
| `bili_comments` | Comentarios de un vídeo |
| `bili_comment_reply` | Publicar un comentario |

## Install

```bash
cd ~/.dsh/profiles/<profile>
dsh plugin add /home/julia/fatfish/plugins/dsh-bili-notify
```

## Config

`cookieEnv` (default `BILIBILI_SESSDATA`), `cookie`, `requestTimeoutMs`, `timeoutMs`, `maxFeedRows`.
