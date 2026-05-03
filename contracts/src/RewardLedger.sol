// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { IRewardLedger } from "./interfaces/IRewardLedger.sol";

/// @title RewardLedger
/// @notice ATLAS RewardLedger v2. Records per-recipient organizer / attendee /
///         referral rewards in stablecoin (idempotent per `(paymentId, kind)`) and lets
///         recipients claim their accumulated balance to themselves or a destination
///         address. v2 adds a reversal flow: an account holding REVERSER_ROLE may call
///         `reverseRewards(paymentId)` to subtract every entry recorded under that
///         paymentId from the corresponding recipient's balance — used when the
///         underlying FeeRouter payment is refunded. The recorder supplies the amounts
///         — this contract does not enforce the protocol's economic split, only the
///         bookkeeping. The settlement token is supplied at initialization time so the
///         contract is portable across EVM chains and stablecoin choices.
contract RewardLedger is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    IRewardLedger
{
    using SafeERC20 for IERC20;

    /// @notice Role permitted to record reward accruals on behalf of recipients.
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    /// @notice Role permitted to pause and unpause recording, claiming, and funding.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role permitted to upgrade the implementation.
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @notice Role permitted to call reverseRewards().
    bytes32 public constant REVERSER_ROLE = keccak256("REVERSER_ROLE");

    /// @dev A single reward entry recorded under a paymentId — replayed in reverse on
    ///      `reverseRewards` to undo the original credit.
    struct RewardEntry {
        address recipient;
        RewardKind kind;
        uint256 amount;
    }

    /// @dev ERC-20 stablecoin used for all payouts. Exposed via {stablecoin}.
    IERC20 private _stablecoin;

    /// @dev recipient → unclaimed accrued balance.
    mapping(address => uint256) private _balances;

    /// @dev keccak256(paymentId, kind) → recorded flag. Powers idempotent recordReward().
    mapping(bytes32 => bool) private _recorded;

    /// @dev paymentId → ordered list of reward entries credited under that payment. Walked
    ///      by `reverseRewards` to subtract each entry from the corresponding recipient.
    mapping(bytes32 => RewardEntry[]) private _entries;

    /// @dev paymentId → reversed flag. Powers idempotent reverseRewards().
    mapping(bytes32 => bool) private _reversed;

    /// @dev Reserves storage to total of 50 slots for upgrade-safety. See OZ upgradeable docs.
    ///      Decrement this when adding a new state slot above.
    uint256[45] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the RewardLedger.
    /// @param admin Receives DEFAULT_ADMIN_ROLE.
    /// @param recorder Receives RECORDER_ROLE (typically the FeeRouter or settlement service).
    /// @param pauser Receives PAUSER_ROLE.
    /// @param upgrader Receives UPGRADER_ROLE.
    /// @param stablecoin_ ERC-20 stablecoin token address used for payouts on this chain.
    /// @dev REVERSER_ROLE is intentionally NOT pre-granted at init — admins grant it
    ///      post-deploy to the settlement service that drives the refund flow.
    function initialize(address admin, address recorder, address pauser, address upgrader, address stablecoin_)
        external
        initializer
    {
        if (admin == address(0)) revert ZeroAddress();
        if (recorder == address(0)) revert ZeroAddress();
        if (pauser == address(0)) revert ZeroAddress();
        if (upgrader == address(0)) revert ZeroAddress();
        if (stablecoin_ == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RECORDER_ROLE, recorder);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(UPGRADER_ROLE, upgrader);

        _stablecoin = IERC20(stablecoin_);
    }

    // ---------------------------------------------------------------------
    // Recorder
    // ---------------------------------------------------------------------

    /// @notice Record an accrued reward for `recipient`. Idempotent per `(paymentId, kind)`.
    /// @dev Reverts {ZeroAddress} if `recipient` is zero, {ZeroAmount} if `amount` is zero,
    ///      and {RewardAlreadyRecorded} if the same `(paymentId, kind)` tuple has already
    ///      been credited. Pure storage write — no external calls — so no `nonReentrant`.
    /// @param recipient The address to credit.
    /// @param kind Which category of reward this entry represents.
    /// @param amount Amount of stablecoin (6-decimal units) to credit.
    /// @param paymentId Off-chain payment identifier the reward derives from.
    function recordReward(address recipient, RewardKind kind, uint256 amount, bytes32 paymentId)
        external
        onlyRole(RECORDER_ROLE)
        whenNotPaused
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        bytes32 key = keccak256(abi.encode(paymentId, kind));
        if (_recorded[key]) revert RewardAlreadyRecorded(paymentId, kind);

        _recorded[key] = true;
        _balances[recipient] += amount;
        _entries[paymentId].push(RewardEntry({ recipient: recipient, kind: kind, amount: amount }));

        emit RewardRecorded(paymentId, recipient, kind, amount);
    }

    // ---------------------------------------------------------------------
    // Reverser
    // ---------------------------------------------------------------------

    /// @notice Reverse every reward entry recorded under `paymentId`. One-shot per paymentId.
    /// @dev Walks the entry list in storage order and subtracts each entry from the
    ///      corresponding recipient's accrued balance. The subtraction uses Solidity 0.8
    ///      checked arithmetic; if any recipient has already claimed (balance is below
    ///      the entry amount) the call reverts and the operator must clawback off-chain.
    ///      `_recorded[(paymentId, kind)]` flags are intentionally NOT cleared — this
    ///      keeps `recordReward` idempotent forever, even after a reversal.
    ///      No external calls — pure storage update — so `nonReentrant` is defense-in-depth.
    /// @param paymentId The payment identifier whose reward entries to reverse.
    function reverseRewards(bytes32 paymentId)
        external
        onlyRole(REVERSER_ROLE)
        nonReentrant
        whenNotPaused
    {
        RewardEntry[] storage entries = _entries[paymentId];
        if (entries.length == 0) revert RewardsNotRecorded(paymentId);
        if (_reversed[paymentId]) revert RewardsAlreadyReversed(paymentId);

        _reversed[paymentId] = true;

        uint256 totalReversed;
        uint256 length = entries.length;
        for (uint256 i = 0; i < length; ++i) {
            RewardEntry storage entry = entries[i];
            // Solidity 0.8 checked subtraction: reverts if recipient has already claimed
            // and their balance is below this entry's amount.
            _balances[entry.recipient] -= entry.amount;
            totalReversed += entry.amount;
        }

        emit RewardsReversed(paymentId, totalReversed);
    }

    // ---------------------------------------------------------------------
    // Claim
    // ---------------------------------------------------------------------

    /// @notice Claim the caller's accrued balance to the caller's own address.
    /// @return amount The amount transferred.
    function claim() external nonReentrant whenNotPaused returns (uint256 amount) {
        return _claim(msg.sender, msg.sender);
    }

    /// @notice Claim the caller's accrued balance to `destination`.
    /// @param destination The address that receives the stablecoin transfer.
    /// @return amount The amount transferred.
    function claimTo(address destination) external nonReentrant whenNotPaused returns (uint256 amount) {
        if (destination == address(0)) revert ZeroAddress();
        return _claim(msg.sender, destination);
    }

    /// @dev Effects-before-interactions claim. Zeroes the claimer's balance before the
    ///      stablecoin transfer so any reentry through the token contract observes a
    ///      zeroed balance and reverts {NoBalance}.
    function _claim(address claimer, address destination) internal returns (uint256 amount) {
        amount = _balances[claimer];
        if (amount == 0) revert NoBalance();

        _balances[claimer] = 0;

        _stablecoin.safeTransfer(destination, amount);

        emit Claimed(claimer, destination, amount);
    }

    // ---------------------------------------------------------------------
    // Fund
    // ---------------------------------------------------------------------

    /// @notice Deposit stablecoin into the ledger. Anyone may fund — typically the
    ///         FeeRouter or backend settlement service tops up the contract before
    ///         recipients claim.
    /// @param amount Amount of stablecoin to deposit.
    function fund(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        _stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        emit Funded(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Pause
    // ---------------------------------------------------------------------

    /// @notice Pause recording, claims, and funding.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause recording, claims, and funding.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IRewardLedger
    function balanceOf(address recipient) external view override returns (uint256) {
        return _balances[recipient];
    }

    /// @inheritdoc IRewardLedger
    function isRecorded(bytes32 paymentId, RewardKind kind) external view override returns (bool) {
        return _recorded[keccak256(abi.encode(paymentId, kind))];
    }

    /// @inheritdoc IRewardLedger
    function isReversed(bytes32 paymentId) external view override returns (bool) {
        return _reversed[paymentId];
    }

    /// @inheritdoc IRewardLedger
    function stablecoin() external view override returns (address) {
        return address(_stablecoin);
    }

    // ---------------------------------------------------------------------
    // UUPS
    // ---------------------------------------------------------------------

    /// @dev Restricts upgrades to UPGRADER_ROLE.
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) { }
}
