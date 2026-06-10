#!/usr/bin/env node

const [major, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(
    `@azzle/agents requires Node.js >= 22 (you have ${process.versions.node}).\n` +
      "Install the current LTS: https://nodejs.org/"
  );
  process.exit(1);
}

await import("../dist/cli.js");
