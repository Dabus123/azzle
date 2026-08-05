// SPDX-License-Identifier: MIT

//########################################################################################
//########################################################################################
//########################################################################################
//########################################################################################
//########################################.      .########################################
//######################################-          .######################################
//#####################################.            .#####################################
//###############################.+###.              .####-.##############################
//##############################.  ##.                .##-  -#############################
//################################+#.                  .####-#############################
//############################-####.                    .-################################
//##########################-#####.                     .######-##########################
//###############################.          .##-       .+ .######+-#######################
//######################   #####.           ####+     --   .#####   ######################
//##########################+##.          .######- .--      .##+##########################
//############################.           #######+.          .############################
//#############444###########.          .#######.##-          .###########111#############
//##########################.          .#######-####-          .##########################
//#########################.          .-.###.   -##+.-          .#########################
//########################.          .#####.     ######          .########################
//#######################.          .######-    .#######          .#######################
//######################-          .#############+#######          .######################
//#####################.          .######+################          .#####################
//####################-          .#####-############+######          .####################
//###################.          .#####################-#####          .###################
//##################-          .##.  .################-  .###          .##################
//##################         .######+###################+#####.         #GENTIC#LABOR#####
//########################################################################################
//#################AZZLE.ORG##############################################################
//#################SMART#CONTRACT#SUITE###################################################
//##########################. .. .########################################################
//##################..-##..#####. ########################################################
//###################..#. #####. #########################################################
//####################   ####. .##########################################################
//#####################.+###......########################################################
//########################################################################################
//########################################################################################

pragma solidity ^0.8.24;

import {V2Ownable2Step} from "./access/V2Ownable2Step.sol";

/// @notice Minimal task outcome ledger. Ties are deliberately reputation-neutral.
contract ReputationRegistryV2 is V2Ownable2Step {
    /// @dev Note: `completed` / `wins` / `losses` are uint64. Overflow would require ~1.8×10¹⁹
    ///      recorded events against a single address — not reachable at any realistic transaction
    ///      volume; no uint256 upgrade planned.
    struct Reputation {
        uint64 completed;
        uint64 wins;
        uint64 losses;
    }

    address public registry;
    address public arbitration;
    mapping(address => Reputation) public reputation;
    mapping(uint256 => bool) public recorded;

    event Configured(address indexed registry, address indexed arbitration);
    event CompletionRecorded(uint256 indexed taskId, address indexed poster, address indexed worker);
    event DisputeRecorded(uint256 indexed taskId, address winner, address loser, bool neutral);
    event PosterExpiryRecorded(uint256 indexed taskId, address indexed poster, address indexed worker);
    event UnresolvedDisputeRecorded(uint256 indexed taskId, address indexed poster);

    modifier onlyRegistry() {
        require(msg.sender == registry, "RRv2: registry");
        _;
    }
    modifier onlyArbitration() {
        require(msg.sender == arbitration, "RRv2: arbitration");
        _;
    }

    constructor(address initialOwner) V2Ownable2Step(initialOwner) {}

    /// @dev Accepted Risk (deliberate trade-off): no check that _registry != _arbitration. Both are
    ///      validated only by code.length != 0. In the actual deployed graph these are always distinct
    ///      contracts wired atomically by AzzleSuiteV2Factory, so this is a deploy-time trust assumption
    ///      on the bootstrap process, not a runtime-enforced invariant.
    function configure(address _registry, address _arbitration) external onlyOwner {
        require(registry == address(0) && _registry.code.length != 0 && _arbitration.code.length != 0, "RRv2: config");
        registry = _registry;
        arbitration = _arbitration;
        emit Configured(_registry, _arbitration);
    }

    /// @dev Accepted Risk (deliberate trade-off): no poster != worker check, unlike recordPosterExpiry/
    ///      recordDispute. TaskRegistryV2.claim() already enforces msg.sender != poster at the source,
    ///      making poster == worker unreachable through the real registry — this check is intentionally
    ///      omitted here rather than duplicated.
    function recordCompletion(uint256 taskId, address poster, address worker) external onlyRegistry {
        require(taskId != 0 && !recorded[taskId] && poster != address(0) && worker != address(0), "RRv2: record");
        recorded[taskId] = true;
        reputation[poster].completed++;
        reputation[worker].completed++;
        emit CompletionRecorded(taskId, poster, worker);
    }

    function recordPosterExpiry(uint256 taskId, address poster, address worker) external onlyRegistry {
        require(taskId != 0 && !recorded[taskId] && poster != address(0) && worker != address(0) && poster != worker, "RRv2: expiry");
        recorded[taskId] = true;
        reputation[poster].losses++;
        emit PosterExpiryRecorded(taskId, poster, worker);
    }

    function canRecordDispute(uint256 taskId, address winner, address loser, bool neutral) external view returns (bool) {
        return taskId != 0 && !recorded[taskId]
            && (neutral || (winner != address(0) && loser != address(0) && winner != loser));
    }

    /// @dev SPLIT/MUTUAL pass `neutral=true` — no win/loss counters; differs from credit routing on resolve.
    function recordDispute(uint256 taskId, address winner, address loser, bool neutral) external onlyArbitration {
        require(taskId != 0 && !recorded[taskId], "RRv2: recorded");
        recorded[taskId] = true;
        if (!neutral) {
            require(winner != address(0) && loser != address(0) && winner != loser, "RRv2: parties");
            reputation[winner].wins++;
            reputation[loser].losses++;
        }
        emit DisputeRecorded(taskId, winner, loser, neutral);
    }

    /// @notice Light reputation signal when arbitration times out without a ruling.
    /// @dev Does not set `recorded[taskId]` — `recordDispute` still owns the terminal ledger slot.
    ///      This is not a claim the poster was wrong; only that the dispute path was used and
    ///      did not reach resolution. Escrow still refunds the poster on timeout.
    function recordUnresolvedDispute(uint256 taskId, address poster) external onlyArbitration {
        require(taskId != 0 && !recorded[taskId] && poster != address(0), "RRv2: unresolved");
        reputation[poster].losses++;
        emit UnresolvedDisputeRecorded(taskId, poster);
    }

    function graph() external view returns (address, address) { return (registry, arbitration); }
    function validateGraph() external view returns (bool) {
        return registry.code.length != 0 && arbitration.code.length != 0;
    }
}
