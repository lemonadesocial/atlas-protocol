// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IFeeRouter} from "./interfaces/IFeeRouter.sol";

/// @title FeeRouter
/// @notice Stage 1 ATLAS fee router. Splits incoming USDC payments between an organizer and the protocol treasury
///         according to a single configurable fee schedule. Payments are idempotent per paymentId.
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

    /// @notice Hard cap on protocol fee in basis points (10%).
    uint16 public constant MAX_FEE_BPS = 1000;

    /// @notice Denominator for basis-point math.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Default protocol fee on initialization (2%).
    uint16 public constant INITIAL_FEE_BPS = 200;

    /// @dev USDC token used for all settlements. Exposed via {usdc}.
    IERC20 private _usdc;

    /// @notice Treasury address that receives the protocol fee.
    address public treasury;

    /// @notice Current protocol fee in basis points.
    uint16 public feeBps;

    /// @dev Tracks settled paymentIds for idempotency.
    mapping(bytes32 => bool) private _settled;

    /// @dev Reserved storage gap for future upgrades.
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
    /// @param usdc_ USDC token address.
    function initialize(address admin, address upgrader, address pauser, address treasury_, address usdc_)
        external
        initializer
    {
        if (admin == address(0)) revert ZeroAddress();
        if (upgrader == address(0)) revert ZeroAddress();
        if (pauser == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        if (usdc_ == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, upgrader);
        _grantRole(PAUSER_ROLE, pauser);

        _usdc = IERC20(usdc_);
        treasury = treasury_;
        feeBps = INITIAL_FEE_BPS;
    }

    // ---------------------------------------------------------------------
    // External
    // ---------------------------------------------------------------------

    /// @inheritdoc IFeeRouter
    function settle(address organizer, uint256 amount, bytes32 paymentId)
        external
        override
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (organizer == address(0)) revert ZeroAddress();
        if (_settled[paymentId]) revert PaymentAlreadySettled(paymentId);

        // Effects: mark settled before any external calls.
        _settled[paymentId] = true;

        uint256 protocolFee = (amount * feeBps) / BPS_DENOMINATOR;
        uint256 organizerAmount = amount - protocolFee;

        // Interactions.
        IERC20 token = _usdc;
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (organizerAmount > 0) {
            token.safeTransfer(organizer, organizerAmount);
        }
        if (protocolFee > 0) {
            token.safeTransfer(treasury, protocolFee);
        }

        emit PaymentSettled(paymentId, organizer, organizerAmount, protocolFee);
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
    function usdc() external view override returns (address) {
        return address(_usdc);
    }

    /// @inheritdoc IFeeRouter
    function isSettled(bytes32 paymentId) external view override returns (bool) {
        return _settled[paymentId];
    }

    // ---------------------------------------------------------------------
    // UUPS
    // ---------------------------------------------------------------------

    /// @dev Restricts upgrades to UPGRADER_ROLE.
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}
}
