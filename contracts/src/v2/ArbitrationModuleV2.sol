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
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITaskRegistryArbitrationV2 {
    function taskParties(uint256 taskId) external view returns (address poster, address worker);
    function taskTimelyDelivered(uint256 taskId) external view returns (bool);
    function canResolveDispute(uint256 taskId, uint8 outcome) external view returns (bool);
    function resolveDispute(uint256 taskId, uint8 outcome) external;
}
interface IEscrowArbitrationV2 {
    function freeze(uint256 taskId) external;
    function canSettle(uint256 taskId) external view returns (bool);
    function settle(uint256 taskId, uint16 workerBps) external;
}
interface IReputationArbitrationV2 {
    function canRecordDispute(uint256 taskId, address winner, address loser, bool neutral) external view returns (bool);
    function recordDispute(uint256 taskId, address winner, address loser, bool neutral) external;
    function recordUnresolvedDispute(uint256 taskId, address poster) external;
}
interface IVerifierBondV2 {
    function minimumBond() external view returns (uint256);
    function bonds(address verifier) external view returns (uint256);
    function isEligible(address verifier) external view returns (bool);
    function canRelease(address verifier) external view returns (bool);
    function assign(address verifier) external;
    function release(address verifier) external;
    function assignmentReserve() external view returns (uint256);
    function slashAndRelease(address verifier, uint256 amount) external;
    function treasury() external view returns (address);
}

/// @notice Bounded AZL-only arbitration with deterministic round-robin assignment.
/// @dev The owner curates a transparent panel prospectively. Round-robin cursor advances when an
///      arbitrator is selected — at `openDispute` when capacity exists, or later via `assignArbitrator`
///      when the panel was full at open. No owner can pick an arbitrator after seeing case evidence.
///      Settlement order: `escrow.settle` → `registry.resolveDispute` → reputation → bond release.
contract ArbitrationModuleV2 is V2Ownable2Step, ReentrancyGuard {
    enum Status { NONE, EVIDENCE, RULING, SETTLED }
    enum Outcome { NONE, POSTER_WINS, WORKER_WINS, SPLIT, MUTUAL }

    struct Dispute {
        uint256 taskId;
        address opener;
        address arbitrator;
        bytes32 posterEvidence;
        bytes32 workerEvidence;
        uint64 evidenceDeadline;
        uint64 rulingDeadline;
        Status status;
        Outcome outcome;
        uint256 slashed;
    }

    ITaskRegistryArbitrationV2 public immutable registry;
    IEscrowArbitrationV2 public immutable escrow;
    IReputationArbitrationV2 public immutable reputation;
    IVerifierBondV2 public immutable bonds;
    address public immutable treasury;
    uint64 public immutable evidenceWindow;
    uint64 public immutable rulingWindow;
    uint16 public immutable slashCapBps;
    uint16 public constant NEUTRAL_BAND_BPS = 1_000;
    address[] public panel;
    uint256 public assignmentCursor;
    mapping(address => bool) public authorized;
    mapping(uint256 => Dispute) public disputes;

    event PanelMemberAdded(address indexed member);
    event PanelMemberRemoved(address indexed member);
    event DisputeOpened(uint256 indexed taskId, address indexed opener, address indexed arbitrator, uint64 evidenceDeadline);
    event ArbitratorAssigned(uint256 indexed taskId, address indexed arbitrator);
    event EvidenceSubmitted(uint256 indexed taskId, address indexed party, bytes32 evidenceHash);
    event RulingPhaseStarted(uint256 indexed taskId, uint64 rulingDeadline);
    event Ruled(uint256 indexed taskId, Outcome outcome, uint16 workerBps);
    event ArbitratorSlashed(uint256 indexed taskId, address indexed arbitrator, uint256 amount);

    constructor(
        address _registry,
        address _escrow,
        address _reputation,
        address _bonds,
        address _treasury,
        uint64 _evidenceWindow,
        uint64 _rulingWindow,
        uint16 _slashCapBps,
        address[] memory initialPanel,
        address initialOwner
    ) V2Ownable2Step(initialOwner) {
        require(
            _registry.code.length != 0 && _escrow.code.length != 0 && _reputation.code.length != 0
                && _bonds.code.length != 0 && _treasury.code.length != 0
                && _evidenceWindow > 0 && _rulingWindow > 0 && _slashCapBps <= 10_000,
            "AMv2: config"
        );
        registry = ITaskRegistryArbitrationV2(_registry);
        escrow = IEscrowArbitrationV2(_escrow);
        reputation = IReputationArbitrationV2(_reputation);
        bonds = IVerifierBondV2(_bonds);
        treasury = _treasury;
        evidenceWindow = _evidenceWindow;
        rulingWindow = _rulingWindow;
        slashCapBps = _slashCapBps;
        for (uint256 i; i < initialPanel.length; ++i) _addPanelMember(initialPanel[i]);
    }

    modifier onlyRegistry() { require(msg.sender == address(registry), "AMv2: registry"); _; }

    function addPanelMember(address member) external onlyOwner { _addPanelMember(member); }

    function removePanelMember(address member) external onlyOwner {
        require(authorized[member], "AMv2: member");
        require(!bonds.canRelease(member), "AMv2: active assignment");
        if (bonds.isEligible(member)) {
            require(_hasEligiblePanelMemberExcluding(member), "AMv2: final eligible member");
        }
        authorized[member] = false;
        uint256 length = panel.length;
        for (uint256 i; i < length; ++i) {
            if (panel[i] != member) continue;
            // Keep the index stable. Swap-and-pop would let governance move
            // a chosen member into the next round-robin slot after seeing a case.
            panel[i] = address(0);
            emit PanelMemberRemoved(member);
            return;
        }
        revert("AMv2: panel invariant");
    }

    function panelLength() external view returns (uint256) { return panel.length; }

    /// @notice Returns the committed panel member at `index` for deployment finalization checks.
    function panelMember(uint256 index) external view returns (address) {
        return panel[index];
    }

    /// @notice Keeps at least one live eligible arbitrator while panel bonds are withdrawable.
    /// @dev Called by the bond vault before it schedules a member's withdrawal.
    function hasEligiblePanelMemberExcluding(address excluded) external view returns (bool) {
        require(msg.sender == address(bonds), "AMv2: bonds");
        return _hasEligiblePanelMemberExcluding(excluded);
    }

    function _hasEligiblePanelMemberExcluding(address excluded) internal view returns (bool) {
        uint256 length = panel.length;
        for (uint256 i; i < length; ++i) {
            address member = panel[i];
            if (member != excluded && authorized[member] && bonds.isEligible(member)) return true;
        }
        return false;
    }

    /// @dev Round-robin at open when capacity exists; `arbitrator` may be zero until `assignArbitrator`.
    function openDispute(uint256 taskId, address opener, bytes32 evidenceHash) external onlyRegistry nonReentrant {
        require(taskId != 0 && disputes[taskId].status == Status.NONE && evidenceHash != bytes32(0), "AMv2: dispute");
        (address poster, address worker) = registry.taskParties(taskId);
        address arbitrator = _nextArbitrator(poster, worker);
        uint64 evidenceDeadline = uint64(block.timestamp) + evidenceWindow;
        disputes[taskId] = Dispute({
            taskId: taskId,
            opener: opener,
            arbitrator: arbitrator,
            posterEvidence: bytes32(0),
            workerEvidence: bytes32(0),
            evidenceDeadline: evidenceDeadline,
            rulingDeadline: 0,
            status: Status.EVIDENCE,
            outcome: Outcome.NONE,
            slashed: 0
        });

        if (opener == poster) disputes[taskId].posterEvidence = evidenceHash;
        else if (opener == worker) disputes[taskId].workerEvidence = evidenceHash;
        else revert("AMv2: opener");
        if (arbitrator != address(0)) bonds.assign(arbitrator);
        escrow.freeze(taskId);
        emit DisputeOpened(taskId, opener, arbitrator, evidenceDeadline);
        emit EvidenceSubmitted(taskId, opener, evidenceHash);
    }

    /// @notice Permissionlessly fills a dispute opened while all panel capacity was occupied.
    /// @dev Documented capacity fallback — not post-hoc owner selection. Advances the same round-robin
    ///      cursor as `openDispute` and assigns bond before ruling phase deadlines elapse.
    function assignArbitrator(uint256 taskId) external nonReentrant returns (address arbitrator) {
        Dispute storage d = disputes[taskId];
        require(d.arbitrator == address(0), "AMv2: assigned");
        uint256 resolutionDeadline = uint256(d.evidenceDeadline) + rulingWindow;
        bool assignable = (d.status == Status.EVIDENCE || d.status == Status.RULING)
            && block.timestamp + rulingWindow <= resolutionDeadline;
        require(assignable, "AMv2: assignment window");
        (address poster, address worker) = registry.taskParties(taskId);
        arbitrator = _nextArbitrator(poster, worker);
        require(arbitrator != address(0), "AMv2: no bonded panel");
        d.arbitrator = arbitrator;
        bonds.assign(arbitrator);
        if (d.status == Status.RULING) {
            d.rulingDeadline = uint64(block.timestamp) + rulingWindow;
        }
        emit ArbitratorAssigned(taskId, arbitrator);
    }
    function submitEvidence(uint256 taskId, bytes32 evidenceHash) external {
        Dispute storage d = disputes[taskId];
        require(d.status == Status.EVIDENCE && block.timestamp <= d.evidenceDeadline && evidenceHash != bytes32(0), "AMv2: evidence");
        (address poster, address worker) = registry.taskParties(taskId);
        if (msg.sender == poster) d.posterEvidence = evidenceHash;
        else if (msg.sender == worker) d.workerEvidence = evidenceHash;
        else revert("AMv2: party");
        emit EvidenceSubmitted(taskId, msg.sender, evidenceHash);
    }

    function beginRuling(uint256 taskId) public {
        Dispute storage d = disputes[taskId];
        require(d.status == Status.EVIDENCE && block.timestamp > d.evidenceDeadline, "AMv2: phase");
        d.status = Status.RULING;
        d.rulingDeadline = d.evidenceDeadline + rulingWindow;
        emit RulingPhaseStarted(taskId, d.rulingDeadline);
    }

    function rule(uint256 taskId, Outcome outcome, uint16 workerBps) external nonReentrant {
        Dispute storage d = disputes[taskId];
        require(msg.sender == d.arbitrator && outcome != Outcome.NONE, "AMv2: arbitrator");
        if (d.status == Status.EVIDENCE) beginRuling(taskId);
        require(d.status == Status.RULING && block.timestamp <= d.rulingDeadline, "AMv2: deadline");
        _validateAllocation(outcome, workerBps);
        _settle(d, outcome, workerBps, false, 0);
    }

    /// @notice Permissionless fallback prevents permanent lock at an absolute,
    /// non-extendable evidence-plus-ruling deadline.
    /// @dev Non-adjudicated: escrow→poster (`workerBps=0`); MUTUAL resolution via registry callback.
    ///      Does not apply `TaskRegistryV2.expire` poster-default deposit penalties. Assigned arbitrator
    ///      bond may be slashed to treasury per policy; opener is not paid from escrow on timeout.
    ///      Poster receives a light unresolved-dispute reputation signal so "dispute and stall"
    ///      is not strictly dominant over paying or expiring.
    function timeout(uint256 taskId) external nonReentrant {
        Dispute storage d = disputes[taskId];
        uint256 cutoff = d.rulingDeadline != 0
            ? uint256(d.rulingDeadline)
            : uint256(d.evidenceDeadline) + rulingWindow;
        require(
            (d.status == Status.EVIDENCE || d.status == Status.RULING)
                && block.timestamp > cutoff,
            "AMv2: timeout"
        );
        bool assigned = d.arbitrator != address(0);
        uint256 amount;
        if (assigned) {
            uint256 cap = (bonds.minimumBond() * slashCapBps) / 10_000;
            require(cap <= bonds.assignmentReserve(), "AMv2: slash reserve");
            uint256 intended = cap > d.slashed ? cap - d.slashed : 0;
            uint256 bonded = bonds.bonds(d.arbitrator);
            amount = intended < bonded ? intended : bonded;
        }
        // Non-adjudicated timeout mirrors TaskRegistryV2.expire escrow side: full refund to poster.
        uint16 workerBps = 0;
        (address poster,) = registry.taskParties(taskId);
        reputation.recordUnresolvedDispute(taskId, poster);
        _settle(d, Outcome.MUTUAL, workerBps, assigned, amount);
        if (amount > 0) emit ArbitratorSlashed(taskId, d.arbitrator, amount);
    }

    /// @dev Registry `resolveDispute` does not move escrow — this call must precede it.
    ///      Order: escrow → registry → reputation → bonds.
    function _settle(Dispute storage d, Outcome outcome, uint16 workerBps, bool slashAssignment, uint256 slashAmount) internal {
        (address poster, address worker) = registry.taskParties(d.taskId);
        bool neutral = outcome == Outcome.SPLIT || outcome == Outcome.MUTUAL;
        address winner = outcome == Outcome.POSTER_WINS ? poster : outcome == Outcome.WORKER_WINS ? worker : address(0);
        address loser = outcome == Outcome.POSTER_WINS ? worker : outcome == Outcome.WORKER_WINS ? poster : address(0);
        require(
            escrow.canSettle(d.taskId) && registry.canResolveDispute(d.taskId, uint8(outcome))
                && reputation.canRecordDispute(d.taskId, winner, loser, neutral)
                && (d.arbitrator == address(0) || bonds.canRelease(d.arbitrator)),
            "AMv2: settlement preflight"
        );

        d.status = Status.SETTLED;
        d.outcome = outcome;
        if (slashAssignment) d.slashed += slashAmount;
        escrow.settle(d.taskId, workerBps);
        registry.resolveDispute(d.taskId, uint8(outcome));
        reputation.recordDispute(d.taskId, winner, loser, neutral);
        if (d.arbitrator != address(0)) {
            if (slashAssignment) bonds.slashAndRelease(d.arbitrator, slashAmount);
            else bonds.release(d.arbitrator);
        }
        emit Ruled(d.taskId, outcome, workerBps);
    }

    function _validateAllocation(Outcome outcome, uint16 workerBps) internal pure {
        require(workerBps <= 10_000, "AMv2: bps");
        if (outcome == Outcome.POSTER_WINS) require(workerBps == 0, "AMv2: poster allocation");
        else if (outcome == Outcome.WORKER_WINS) require(workerBps == 10_000, "AMv2: worker allocation");
        else if (outcome == Outcome.SPLIT) require(
            workerBps >= NEUTRAL_BAND_BPS && workerBps <= 10_000 - NEUTRAL_BAND_BPS,
            "AMv2: neutral allocation"
        );
        else require(workerBps == 0 || workerBps == 5_000, "AMv2: mutual allocation");
    }

    function _nextArbitrator(address poster, address worker) internal returns (address selected) {
        uint256 length = panel.length;
        require(length > 0, "AMv2: empty panel");
        uint256 start = assignmentCursor % length;
        for (uint256 i; i < length; ++i) {
            uint256 index = (start + i) % length;
            address candidate = panel[index];
            if (
                candidate != address(0) && candidate != poster && candidate != worker
                    && authorized[candidate] && bonds.isEligible(candidate)
            ) {
                assignmentCursor = (index + 1) % length;
                return candidate;
            }
        }
        return address(0);
    }

    function _addPanelMember(address member) internal {
        require(member != address(0) && !authorized[member], "AMv2: member");
        authorized[member] = true;
        panel.push(member);
        emit PanelMemberAdded(member);
    }

    function graph() external view returns (address, address, address, address, address) {
        return (address(registry), address(escrow), address(reputation), address(bonds), treasury);
    }
    function validateGraph() external view returns (bool) {
        return address(registry).code.length != 0 && address(escrow).code.length != 0
            && address(reputation).code.length != 0 && address(bonds).code.length != 0
            && treasury.code.length != 0 && bonds.treasury() == treasury;
    }
}
