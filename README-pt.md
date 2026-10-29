# dsh-bili-notify

Um plugin do DeepSeek Harness que lê menções, respostas e comentários de vídeos do bilibili.

## Tools

| Tool | What it does |
|---|---|
| `bili_notify_unread` | Contadores não lidos |
| `bili_mentions` | Feed de menções |
| `bili_replies` | Feed de respostas |
| `bili_comments` | Comentários de um vídeo |
| `bili_comment_reply` | Publicar um comentário |

## Install

```bash
cd ~/.dsh/profiles/<profile>
dsh plugin add /home/julia/fatfish/plugins/dsh-bili-notify
```

## Config

`cookieEnv` (default `BILIBILI_SESSDATA`), `cookie`, `requestTimeoutMs`, `timeoutMs`, `maxFeedRows`.
