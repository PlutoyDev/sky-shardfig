# Sky Shard Config Generator

Generates config and deploy to Cloudflare CDN via Cloudflare Pages for [Sky Shard](https://github.com/PlutoyDev/sky-shards).

## Idea

Configs are stored in Upstash Redis. This tool will generate a config file on build and deploy it to Cloudflare Pages.
Configs are editable via Discord Bot commands using webhooks and processed by Cloudflare Pages Functions.
