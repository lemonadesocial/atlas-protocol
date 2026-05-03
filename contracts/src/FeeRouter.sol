// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { IFeeRouter } from "./interfaces/IFeeRouter.sol";

/// @title FeeRouter
/// @notice ATLAS FeeRouter v2. Splits incoming stablecoin payments between an organizer, the
///         protocol treasury, and zero or more platform fee recipients (stacked platform fees).
///         Payments are idempotent per paymentId. The settlement token is supplied at
///         initialization time so the contract is portable across EVM chains and stablecoin
///         choices. Settled payments may be reversed by an account holding REFUND_ROLE — the
///         caller supplies the organizer share and any non-listed platform fees, while listed
///         platform-fee recipients refund their cut via pre-approved transferFrom.
contract FeeRouter is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    IFeeRouter
{
    using SafeERC20 for IERC20;

    /// @notice Role permitted to upgrade the implementation.
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @notice Role permitted to pause and unpause settlements.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role permitted to call reverseSettle().
    bytes32 public constant REFUND_ROLE = keccak256("REFUND_ROLE");

    /// @notice Hard cap on protocol fee in basis points (10%).
    uint16 public constant MAX_FEE_BPS = 1000;

    /// @notice Denominator for basis-point math.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Default protocol fee on initialization (0.5%).
    uint16 public constant INITIAL_FEE_BPS = 50;

    /// @notice Maximum cumulative platform fees as a fraction of totalAmount (20%).
    uint16 public constant MAX_TOTAL_PLATFORM_FEES_BPS = 2000;

    /// @notice Minimum organizer share as a fraction of totalAmount (70%).
    uint16 public constant MIN_ORGANIZER_BPS = 7000;

    /// @dev ERC-20 stablecoin used for all settlements. Exposed via {stablecoin}.
    IERC20 private _stablecoin;

    /// @notice Treasury address that receives the protocol fee.
    address public treasury;

    /// @notice Current protocol fee in basis points.
    uint16 public feeBps;

    /// @dev Tracks settled paymentIds for idempotency.
    mapping(bytes32 => bool) private _settled;

    /// @dev Tracks refunded paymentIds — refund is one-shot per payment.
    mapping(bytes32 => bool) private _refunded;

    /// @dev Reserves storage so adding a new state variable later does not collide with derived
    ///      contracts. Decrement when adding a new state slot above. See OZ upgradeable docs.
    uint256[45] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the FeeRouter.
    /// @param admin Receives DEFAULT_ADMIN_ROLE.
    /// @param upgrader Receives UPGRADER_ROLE.
    /// @param pauser Receives PAUSER_ROLE.
    /// @param treasury_ Treasury address that receives the protocol fee.
    /// @param stablecoin_ ERC-20 stablecoin token address used for settlements on this chain.
    function initialize(address admin, address upgrader, address pauser, address treasury_, address stablecoin_)
        external
        initializer
    {
        if (admin == address(0)) revert ZeroAddress();
        if (upgrader == address(0)) revert ZeroAddress();
        if (pauser == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        if (stablecoin_ == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, upgrader);
        _grantRole(PAUSER_ROLE, pauser);

        _stablecoin = IERC20(stablecoin_);
        treasury = treasury_;
        feeBps = INITIAL_FEE_BPS;
    }

    // ---------------------------------------------------------------------
    // External
    // ---------------------------------------------------------------------

    /// @inheritdoc IFeeRouter
    function settle(
        address organizer,
        uint256 totalAmount,
        bytes32 paymentId,
        FeeSplit[] calldata platformFees
    ) external override nonReentrant whenNotPaused {
        if (totalAmount == 0) revert ZeroAmount();
        if (organizer == address(0)) revert ZeroAddress();
        if (_settled[paymentId]) revert PaymentAlreadySettled(paymentId);

        // Effects: mark settled before any external calls.
        _settled[paymentId] = true;

        uint256 protocolFee = (totalAmount * feeBps) / BPS_DENOMINATOR;

        uint256 totalPlatformFees;
        for (uint256 i = 0; i < platformFees.length; ++i) {
            if (platformFees[i].recipient == address(0)) revert ZeroAddress();
            totalPlatformFees += platformFees[i].amount;
        }

        // Cap: sum of platform fees may not exceed MAX_TOTAL_PLATFORM_FEES_BPS of totalAmount.
        // Done via cross-multiplication to avoid an extra division.
        if (totalPlatformFees * BPS_DENOMINATOR > totalAmount * MAX_TOTAL_PLATFORM_FEES_BPS) {
            revert PlatformFeesAboveCap();
        }

        // Underflow-safe: enforced again by the next check + Solidity 0.8 checked subtraction.
        uint256 organizerAmount = totalAmount - protocolFee - totalPlatformFees;

        // Floor: organizer share must remain at least MIN_ORGANIZER_BPS of totalAmount.
        if (organizerAmount * BPS_DENOMINATOR < totalAmount * MIN_ORGANIZER_BPS) {
            revert OrganizerShareBelowFloor();
        }

        // Interactions.
        IERC20 token = _stablecoin;
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        if (organizerAmount > 0) {
            token.safeTransfer(organizer, organizerAmount);
        }
        if (protocolFee > 0) {
            token.safeTransfer(treasury, protocolFee);
        }
        for (uint256 i = 0; i < platformFees.length; ++i) {
            if (platformFees[i].amount > 0) {
                token.safeTransfer(platformFees[i].recipient, platformFees[i].amount);
            }
        }

        emit PaymentSettled(paymentId, organizer, totalAmount, organizerAmount, protocolFee, platformFees);
    }

    /// @inheritdoc IFeeRouter
    function reverseSettle(
        bytes32 paymentId,
        address buyer,
        uint256 refundAmount,
        FeeSplit[] calldata feesToReverse
    ) external override onlyRole(REFUND_ROLE) nonReentrant whenNotPaused {
        if (buyer == address(0)) revert ZeroAddress();
        if (refundAmount == 0) revert ZeroAmount();
        if (!_settled[paymentId]) revert PaymentNotSettled(paymentId);
        if (_refunded[paymentId]) revert PaymentAlreadyRefunded(paymentId);

        // Effects: mark refunded before any external calls.
        _refunded[paymentId] = true;

        IERC20 token = _stablecoin;

        // Validate inputs and tally before any external calls.
        uint256 totalFromRecipients;
        for (uint256 i = 0; i < feesToReverse.length; ++i) {
            if (feesToReverse[i].recipient == address(0)) revert ZeroAddress();
            totalFromRecipients += feesToReverse[i].amount;
        }
        if (totalFromRecipients > refundAmount) revert RefundAmountInvalid();
        uint256 fromCaller = refundAmount - totalFromRecipients;

        // Interactions: pull each fee leg back from its recipient (recipient must pre-approve
        // this contract), then pull the remainder from the caller, then pay the buyer.
        for (uint256 i = 0; i < feesToReverse.length; ++i) {
            uint256 amount = feesToReverse[i].amount;
            if (amount > 0) {
                token.safeTransferFrom(feesToReverse[i].recipient, address(this), amount);
            }
        }
        if (fromCaller > 0) {
            token.safeTransferFrom(msg.sender, address(this), fromCaller);
        }
        token.safeTransfer(buyer, refundAmount);

        emit PaymentReversed(paymentId, buyer, refundAmount, feesToReverse);
    }

    /// @inheritdoc IFeeRouter
    function setFeeBps(uint16 newBps) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > MAX_FEE_BPS) revert FeeBpsTooHigh(newBps, MAX_FEE_BPS);
        uint16 oldBps = feeBps;
        feeBps = newBps;
        emit FeeScheduleUpdated(oldBps, newBps);
    }

    /// @inheritdoc IFeeRouter
    function setTreasury(address newTreasury) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /// @inheritdoc IFeeRouter
    function pause() external override onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @inheritdoc IFeeRouter
    function unpause() external override onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IFeeRouter
    function stablecoin() external view override returns (address) {
        return address(_stablecoin);
    }

    /// @inheritdoc IFeeRouter
    function isSettled(bytes32 paymentId) external view override returns (bool) {
        return _settled[paymentId];
    }

    /// @inheritdoc IFeeRouter
    function isRefunded(bytes32 paymentId) external view override returns (bool) {
        return _refunded[paymentId];
    }

    // ---------------------------------------------------------------------
    // UUPS
    // ---------------------------------------------------------------------

    /// @dev Restricts upgrades to UPGRADER_ROLE.
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) { }
}
