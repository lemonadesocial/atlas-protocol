// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @title IRewardLedger
/// @notice External interface for the ATLAS RewardLedger (v2 — adds reward reversal flow).
///         Declares the reward kind enum, custom errors, events, and read-only
///         views integrators rely on. The accrual write path (`recordReward`),
///         claim path (`claim` / `claimTo` / `fund`), and reversal path
///         (`reverseRewards`) live on the implementation contract; integrators
///         encode them via the SDK.
interface IRewardLedger {
    /// @notice Category of accrued reward.
    /// @dev Values 0/1/2 are part of the public ABI — DO NOT reorder without a
    ///      coordinated upgrade across the contract, the SDK, and any indexer
    ///      that consumes `RewardRecorded` event topics.
    enum RewardKind {
        ORGANIZER,
        ATTENDEE,
        REFERRAL
    }

    /// @notice Emitted when a reward is recorded against a recipient.
    /// @param paymentId The off-chain payment identifier the reward derives from.
    /// @param recipient The address whose accrued balance was credited.
    /// @param kind Which category of reward this entry represents.
    /// @param amount Amount of stablecoin (6-decimal units) credited.
    event RewardRecorded(
        bytes32 indexed paymentId, address indexed recipient, RewardKind indexed kind, uint256 amount
    );

    /// @notice Emitted when a recipient (or its delegate) claims an accrued balance.
    /// @param claimer The address whose balance was drained.
    /// @param destination The address that received the stablecoin transfer.
    /// @param amount Amount of stablecoin transferred.
    event Claimed(address indexed claimer, address indexed destination, uint256 amount);

    /// @notice Emitted when stablecoin is deposited into the ledger.
    /// @param from The address that funded the ledger.
    /// @param amount Amount of stablecoin deposited.
    event Funded(address indexed from, uint256 amount);

    /// @notice Emitted when every reward entry recorded under `paymentId` is reversed.
    /// @param paymentId The off-chain payment identifier whose entries were reversed.
    /// @param totalReversed The cumulative amount subtracted across all affected recipients.
    event RewardsReversed(bytes32 indexed paymentId, uint256 totalReversed);

    /// @notice Reverts when an address argument is the zero address.
    error ZeroAddress();

    /// @notice Reverts when an amount argument is zero.
    error ZeroAmount();

    /// @notice Reverts when `recordReward` is called twice for the same `(paymentId, kind)`.
    /// @param paymentId The duplicate payment identifier.
    /// @param kind The duplicate reward kind.
    error RewardAlreadyRecorded(bytes32 paymentId, RewardKind kind);

    /// @notice Reverts when a claim is attempted for a recipient with no accrued balance.
    error NoBalance();

    /// @notice Reverts when `reverseRewards` is called for a `paymentId` that has no recorded entries.
    /// @param paymentId The payment identifier with no recorded rewards.
    error RewardsNotRecorded(bytes32 paymentId);

    /// @notice Reverts when `reverseRewards` is called twice for the same `paymentId`.
    /// @param paymentId The payment identifier already reversed.
    error RewardsAlreadyReversed(bytes32 paymentId);

    /// @notice Returns the unclaimed accrued balance for `recipient`.
    /// @param recipient The address whose balance to query.
    function balanceOf(address recipient) external view returns (uint256);

    /// @notice Returns whether a `(paymentId, kind)` tuple has already been recorded.
    /// @param paymentId The payment identifier to query.
    /// @param kind The reward kind to query.
    function isRecorded(bytes32 paymentId, RewardKind kind) external view returns (bool);

    /// @notice Returns whether all reward entries for `paymentId` have been reversed.
    /// @param paymentId The payment identifier to query.
    function isReversed(bytes32 paymentId) external view returns (bool);

    /// @notice The ERC-20 stablecoin token address used for payouts on this chain.
    function stablecoin() external view returns (address);

    /// @notice Reverse every reward entry recorded under `paymentId`, subtracting each
    ///         entry from the corresponding recipient's accrued balance. Idempotent
    ///         per-paymentId — a second call reverts {RewardsAlreadyReversed}.
    /// @dev Reverts {RewardsNotRecorded} when no entries exist for `paymentId`. The
    ///      subtraction uses Solidity 0.8 checked arithmetic; if any recipient has
    ///      already claimed (so their balance is below the entry amount) the call
    ///      reverts and the operator must clawback off-chain. Restricted to
    ///      REVERSER_ROLE.
    /// @param paymentId The payment identifier whose reward entries to reverse.
    function reverseRewards(bytes32 paymentId) external;
}
