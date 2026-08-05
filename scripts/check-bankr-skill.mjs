import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const skillRoot = resolve(root, "agents", "bankr-skill", "azzle");
const manifest = JSON.parse(
  readFileSync(resolve(root, "contracts", "deployments", "base-8453.json"), "utf8"),
);

const requiredFiles = [
  "SKILL.md",
  "catalog.json",
  "references/onboarding.md",
  "references/protocol.md",
  "scripts/v2-tasks.sh",
];

const failures = [];
function fail(message) {
  failures.push(message);
}

function filesIn(directory) {
  const out = [];
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else out.push(path);
  }
  return out;
}

for (const file of requiredFiles) {
  try {
    readFileSync(resolve(skillRoot, file), "utf8");
  } catch {
    fail(`missing required file: ${file}`);
  }
}

const textFiles = filesIn(skillRoot).filter((path) => !path.endsWith(".svg"));
const content = textFiles
  .map((path) => `${relative(skillRoot, path)}\n${readFileSync(path, "utf8")}`)
  .join("\n");

for (const [key, address] of [
  ["taskRegistry", manifest.taskRegistry],
  ["escrowVault", manifest.escrowVault],
  ["depositVault", manifest.depositVault],
  ["paymentGateway", manifest.paymentGateway],
  ["pricingPolicy", manifest.pricingPolicy],
  ["taskScopeRegistry", manifest.taskScopeRegistry],
  ["arbitrationModule", manifest.arbitrationModule],
  ["stakingVault", manifest.stakingVault],
  ["verifierBondVault", manifest.verifierBondVault],
  ["external.azl", manifest.external?.azl],
  ["external.usdc", manifest.external?.usdc],
]) {
  if (!address) fail(`canonical manifest is missing ${key}`);
  else if (!content.toLowerCase().includes(address.toLowerCase())) {
    fail(`skill does not contain canonical ${key} address ${address}`);
  }
}

const requiredPhrases = [
  'version == "2.0.0"',
  "chainId == \"8453\"",
  "AZL wei (18 decimals)",
  "paymentGateway",
  "paymentGateway.intakePaused()",
  "pricingPolicy.quoteTask()",
  "Base RPC",
  "markDelivered",
  "CANCELLED",
  "explicit user confirmation",
];
for (const phrase of requiredPhrases) {
  if (!content.includes(phrase)) fail(`missing required V2 phrase: ${phrase}`);
}

const forbidden = [
  [/api\.studio\.thegraph\.com/i, "retired subgraph URL"],
  [/AZZLE_SUBGRAPH_URL/i, "retired subgraph environment variable"],
  [new RegExp(`Subgraph${"Indexer"}`, "i"), "retired SDK indexer"],
  [/subgraph-open-tasks/i, "retired discovery script"],
  [/\bpostTask\b/, "legacy postTask selector"],
  [/\bclaimTask\b/, "legacy claimTask selector"],
  [/\bfundTask\b/, "legacy fundTask selector"],
  [/\bstartWork\b/, "legacy startWork selector"],
  [/\bsubmitProof\b/, "legacy submitProof selector"],
  [/\bacceptMilestone\b/, "legacy acceptMilestone selector"],
  [/\bIN_REVIEW\b/, "legacy IN_REVIEW state"],
  [/\bPAUSED\b/, "legacy PAUSED state"],
  [/\bDELETED\b/, "legacy DELETED state"],
  [/\b20 USDC\b/i, "legacy $20 entry deposit"],
  [/\b1,000 (?:AZL|AZZLE)\b/i, "legacy fixed AZL access fee"],
  [/\bUSDC escrow\b/i, "legacy USDC task escrow"],
  [/0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48/i, "legacy TaskRegistry address"],
  [/0xd1f3058650ab22250d139dba5b2b48118071dc36/i, "legacy EscrowVault address"],
  [/0x62808379CbDEfe7E8b2FcD659158E49463c34e5D/i, "legacy AgentDepositVault address"],
  [/0x6bEBf56a67c8B38cB4d8FF328252FbE9662201b6/i, "legacy TreasuryRouter address"],
];
for (const [pattern, label] of forbidden) {
  if (pattern.test(content)) fail(`contains ${label}`);
}

try {
  const catalog = JSON.parse(readFileSync(resolve(skillRoot, "catalog.json"), "utf8"));
  if (catalog.slug !== "azzle") fail("catalog slug must be azzle");
  if (catalog.install?.repoPath !== "azzle") fail("catalog repoPath must be azzle");
} catch (error) {
  fail(`catalog.json is invalid: ${error.message}`);
}

const bash = spawnSync(
  "bash",
  ["-n", resolve(skillRoot, "scripts", "v2-tasks.sh")],
  { encoding: "utf8" },
);
const bashUnavailable = process.platform === "win32" || bash.error?.code === "ENOENT";
if (bash.error && !bashUnavailable) {
  fail(`could not run Bash syntax check: ${bash.error.message}`);
} else if (!bashUnavailable && bash.status !== 0) {
  fail(`v2-tasks.sh failed Bash syntax check: ${bash.stderr.trim()}`);
}

if (failures.length) {
  console.error("Bankr AZZLE skill validation failed:");
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Bankr AZZLE skill is canonical V2 (${textFiles.length} files checked).`);
