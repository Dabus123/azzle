import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "src");
const auditRoot = path.join(__dirname, "..", "audit");

function stripHeader(content) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\/\/ SPDX-License-Identifier:.*\n/g, "")
    .replace(/pragma solidity[^;]+;\n?/g, "")
    .replace(/import\s*\{[^}]+\}\s*from\s*[^;]+;\n?/g, "")
    .replace(/import\s*[^;]+;\n?/g, "")
    .trim();
}

const interfaces = [
  "interfaces/ITaskRegistry.sol",
  "interfaces/IEscrowVault.sol",
  "interfaces/IArbitrationModule.sol",
  "interfaces/IAgentDepositVault.sol",
  "interfaces/IArbitrationRecovery.sol",
  "interfaces/ITaskScopeRegistry.sol",
];
const contracts = [
  "ArbitrationRecoveryCoordinator.sol",
  "EscrowVault.sol",
  "UnionStakingVault.sol",
  "ReputationRegistry.sol",
  "TreasuryRouter.sol",
  "AgentDepositVault.sol",
  "TaskScopeRegistry.sol",
  "ArbitrationModule.sol",
  "ArbitrationSatellite.sol",
  "TaskRegistry.sol",
];

const header = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =============================================================================
// AuditAzzle.sol — merged AZZLE protocol contracts for third-party audit
// Generated from 10 production contracts + 6 interfaces. Logic unchanged.
// =============================================================================

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

`;

let out = header;

for (const f of interfaces) {
  out += `\n// -------------------------------------------------------------------------\n// From: ${f}\n// -------------------------------------------------------------------------\n\n`;
  out += stripHeader(fs.readFileSync(path.join(root, f), "utf8")).trim() + "\n";
}

for (const f of contracts) {
  out += `\n// -------------------------------------------------------------------------\n// From: ${f}\n// -------------------------------------------------------------------------\n\n`;
  out += stripHeader(fs.readFileSync(path.join(root, f), "utf8")).trim() + "\n";
}

fs.mkdirSync(auditRoot, { recursive: true });
const outPath = path.join(auditRoot, "AuditAzzle.sol");
fs.writeFileSync(outPath, out);
console.log("Wrote", outPath, "lines:", out.split("\n").length);
