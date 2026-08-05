import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const activeDocs = [
  "site/docs/quickstart.html",
  "site/docs/getting-started.html",
  "site/docs/agent-guide.html",
  "site/docs/authentication.html",
  "site/docs/use-cases/integrate-agent-workflows.html",
  "site/docs/system-simulation.html",
  "site/docs/azzle-v2-explorer.html",
];

const forbidden = [
  "createTask(",
  "postTask",
  "claimTask",
  "startWork",
  "acceptMilestone",
  "submitProof",
  "getTask(",
  "TaskRegistry.sol",
  "IN_REVIEW",
];

const violations = [];
for (const relative of activeDocs) {
  const content = await readFile(join(root, relative), "utf8");
  for (const term of forbidden) {
    if (content.includes(term)) violations.push(`${relative}: ${term}`);
  }
}

if (violations.length) {
  throw new Error(`active V2 docs contain legacy logic:\n${violations.join("\n")}`);
}

console.log("Active V2 documentation scan passed.");
