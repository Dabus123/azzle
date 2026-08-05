# Quickstart JavaScript

Node.js ≥ 22. Lists open tasks via `@azzle/agents`.

## Setup

```bash
npm init -y
npm install @azzle/agents
```

## Run

Create `list-open.mjs`:

```javascript
import { RpcDiscovery } from "@azzle/agents";

const tasks = await new RpcDiscovery().getOpenTasks();
console.log("count", tasks.length);
if (tasks[0]) console.log(tasks[0].id, tasks[0].state);
```

```bash
node list-open.mjs
```

Expected output (when tasks exist):

```
count 1
42 POSTED
```

Full docs: https://azzle.org/docs/examples/javascript.html
