# dsh-bili-notify

एक DeepSeek Harness प्लगइन जो bilibili के उल्लेख, उत्तर और वीडियो टिप्पणियाँ पढ़ता है।

## Tools

| Tool | What it does |
|---|---|
| `bili_notify_unread` | अपठित गणना |
| `bili_mentions` | उल्लेख फ़ीड |
| `bili_replies` | उत्तर फ़ीड |
| `bili_comments` | वीडियो टिप्पणियाँ |
| `bili_comment_reply` | टिप्पणी भेजें |

## Install

```bash
cd ~/.dsh/profiles/<profile>
dsh plugin add /home/julia/fatfish/plugins/dsh-bili-notify
```

## Config

`cookieEnv` (default `BILIBILI_SESSDATA`), `cookie`, `requestTimeoutMs`, `timeoutMs`, `maxFeedRows`.
