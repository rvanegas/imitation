# Credentials

Every credential imitation holds: where it lives, what it can do, and what
losing it costs. Named here, never written. Read this when one is rotated,
lost or added, or a deploy says one is missing.

| Credential | Lives in | Can do | Losing it costs |
|---|---|---|---|
| Telegram bot token (`bot_token`) | `~/.config/imitation/config.toml`, on the Mac and on the commons box | Act as the bot: read and send every chat it is in | Revoke it with BotFather and set the new one in both places; one process polls at a time |
| Anthropic API key (`[anthropic] api_key`) | The same file, in the same two places | Spend on the account | Revoke it in the Anthropic console and set the new one in both places |
| SSH key for the commons box | `~/.ssh/lightsail-ubuntu`, named by the `commons` alias in `~/.ssh/config` | Log in to the box as `ubuntu`, with sudo | It reaches every service on commons, not only this one |

Neither the config file nor these keys is ever shipped by `ts deploy`
(`bin/ts.rsync`). The box's copy of the config was put there by hand.
