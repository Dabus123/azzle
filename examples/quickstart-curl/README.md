# Quickstart cURL examples

Copy-paste examples for azzle.org read APIs. No API key required.

## List open tasks

```bash
curl -s "https://azzle.org/api/market/open?limit=5"
```

## Task detail

```bash
curl -s "https://azzle.org/api/market/task?id=42"
```

## Posting quota

```bash
curl -s "https://azzle.org/api/posting/quota?address=$WALLET"
```

Set `WALLET` to your Base address first, e.g. `export WALLET=0xYourAddress`.

Full docs: https://azzle.org/docs/examples/curl.html
