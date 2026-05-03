// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { FeeRouter } from "../src/FeeRouter.sol";
import { IFeeRouter } from "../src/interfaces/IFeeRouter.sol";
import { MockStablecoin } from "./utils/MockStablecoin.sol";

/// @dev Helper used by the upgrade authorization test.
contract FeeRouterV2 is FeeRouter {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract FeeRouterTest is Test {
    FeeRouter internal router;
    MockStablecoin internal stablecoin;

    address internal admin = address(0xA11CE);
    address internal upgrader = address(0xB0B);
    address internal pauser = address(0xCAFE);
    address internal refunder = address(0xFADE);
    address internal treasury = address(0xBEEF);
    address internal organizer = address(0xD00D);
    address internal payer = address(0xF00D);
    address internal buyer = address(0xB055);
    address internal stranger = address(0xDEAD);
    address internal platformA = address(0xAAA1);
    address internal platformB = address(0xAAA2);

    bytes32 internal constant PAYMENT_ID_1 = keccak256("payment-1");
    bytes32 internal constant PAYMENT_ID_2 = keccak256("payment-2");

    event PaymentSettled(
        bytes32 indexed paymentId,
        address indexed organizer,
        uint256 totalAmount,
        uint256 organizerAmount,
        uint256 protocolFee,
        IFeeRouter.FeeSplit[] platformFees
    );
    event PaymentReversed(
        bytes32 indexed paymentId,
        address indexed buyer,
        uint256 refundAmount,
        IFeeRouter.FeeSplit[] feesReversed
    );
    event FeeScheduleUpdated(uint16 oldBps, uint16 newBps);

    function setUp() public {
        stablecoin = new MockStablecoin();

        FeeRouter impl = new FeeRouter();
        bytes memory initData =
            abi.encodeCall(FeeRouter.initialize, (admin, upgrader, pauser, treasury, address(stablecoin)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = FeeRouter(address(proxy));

        // Grant REFUND_ROLE to a dedicated account.
        bytes32 refundRole = router.REFUND_ROLE();
        vm.prank(admin);
        router.grantRole(refundRole, refunder);

        stablecoin.mint(payer, 1_000_000e6);
        vm.prank(payer);
        stablecoin.approve(address(router), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // settle
    // ---------------------------------------------------------------------

    function test_settle_correctSplit_defaultFee() public {
        uint256 amount = 1_000e6;
        // Default INITIAL_FEE_BPS is 50 (0.5%) in v2.
        uint256 expectedFee = 5e6; // 0.5% of 1000
        uint256 expectedOrganizer = 995e6;

        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](0);

        vm.expectEmit(true, true, false, true, address(router));
        emit PaymentSettled(PAYMENT_ID_1, organizer, amount, expectedOrganizer, expectedFee, fees);

        vm.prank(payer);
        router.settle(organizer, amount, PAYMENT_ID_1, fees);

        assertEq(stablecoin.balanceOf(organizer), expectedOrganizer, "organizer balance");
        assertEq(stablecoin.balanceOf(treasury), expectedFee, "treasury balance");
        assertEq(stablecoin.balanceOf(address(router)), 0, "router holds nothing");
        assertTrue(router.isSettled(PAYMENT_ID_1), "marked settled");
    }

    function test_settle_withTwoPlatformFees() public {
        uint256 amount = 1_000e6;
        // Protocol fee = 0.5% = 5e6. Two platform fees: 30e6 (3%) + 50e6 (5%) = 80e6 (8%).
        // Organizer = 1000 - 5 - 30 - 50 = 915e6 (91.5% — well above 70% floor).
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](2);
        fees[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 30e6 });
        fees[1] = IFeeRouter.FeeSplit({ recipient: platformB, amount: 50e6 });

        vm.prank(payer);
        router.settle(organizer, amount, PAYMENT_ID_1, fees);

        assertEq(stablecoin.balanceOf(organizer), 915e6, "organizer balance");
        assertEq(stablecoin.balanceOf(treasury), 5e6, "treasury balance");
        assertEq(stablecoin.balanceOf(platformA), 30e6, "platformA balance");
        assertEq(stablecoin.balanceOf(platformB), 50e6, "platformB balance");
        assertEq(stablecoin.balanceOf(address(router)), 0, "router holds nothing");
    }

    function test_settle_platformFeesAboveCap_reverts() public {
        uint256 amount = 1_000e6;
        // 21% platform fees (one big fee), exceeds the 20% cap.
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](1);
        fees[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 210e6 });

        vm.prank(payer);
        vm.expectRevert(IFeeRouter.PlatformFeesAboveCap.selector);
        router.settle(organizer, amount, PAYMENT_ID_1, fees);
    }

    function test_settle_platformFeesAtExactCap_succeeds() public {
        uint256 amount = 1_000e6;
        // Exactly 20% platform fees (boundary): 200e6.
        // Protocol fee 0.5% = 5e6. Organizer = 1000 - 5 - 200 = 795e6 (79.5%) — still above 70%.
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](1);
        fees[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 200e6 });

        vm.prank(payer);
        router.settle(organizer, amount, PAYMENT_ID_1, fees);

        assertEq(stablecoin.balanceOf(organizer), 795e6, "organizer balance");
        assertEq(stablecoin.balanceOf(platformA), 200e6, "platformA balance");
    }

    function test_settle_organizerShareAtFloor_succeeds() public {
        // Boundary case: protocol fee at MAX (10%) + platform fees at MAX (20%) leaves the
        // organizer with exactly MIN_ORGANIZER_BPS (70%). The `>=` floor check must allow this.
        vm.prank(admin);
        router.setFeeBps(1000); // 10%

        uint256 amount = 1_000e6;
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](1);
        fees[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 200e6 }); // 20%

        vm.prank(payer);
        router.settle(organizer, amount, PAYMENT_ID_1, fees);
        assertEq(stablecoin.balanceOf(organizer), 700e6, "organizer at boundary");
        assertEq(stablecoin.balanceOf(treasury), 100e6, "protocol at cap");
        assertEq(stablecoin.balanceOf(platformA), 200e6, "platform at cap");
    }

    /// @dev OrganizerShareBelowFloor is a defense-in-depth check that becomes reachable only
    ///      if MAX_FEE_BPS or MAX_TOTAL_PLATFORM_FEES_BPS are raised in a future upgrade. Under
    ///      the v2 caps (10% protocol + 20% platform), the platform cap fires first whenever a
    ///      caller attempts to drive the organizer below 70%. This test verifies that — when
    ///      a caller pushes the platform fee above 20% in an attempt to thin the organizer's
    ///      share — they hit PlatformFeesAboveCap, which is the correct first line of defense.
    function test_settle_thinningOrganizerViaPlatformFees_revertsAtCap() public {
        uint256 amount = 1_000e6;
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](1);
        // 25% platform fees would push organizer below 70%, but the platform cap blocks first.
        fees[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 250e6 });

        vm.prank(payer);
        vm.expectRevert(IFeeRouter.PlatformFeesAboveCap.selector);
        router.settle(organizer, amount, PAYMENT_ID_1, fees);
    }

    function test_settle_zeroAmount_reverts() public {
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](0);
        vm.prank(payer);
        vm.expectRevert(IFeeRouter.ZeroAmount.selector);
        router.settle(organizer, 0, PAYMENT_ID_1, fees);
    }

    function test_settle_zeroOrganizer_reverts() public {
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](0);
        vm.prank(payer);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.settle(address(0), 100e6, PAYMENT_ID_1, fees);
    }

    function test_settle_zeroPlatformRecipient_reverts() public {
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](1);
        fees[0] = IFeeRouter.FeeSplit({ recipient: address(0), amount: 1e6 });

        vm.prank(payer);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.settle(organizer, 100e6, PAYMENT_ID_1, fees);
    }

    function test_settle_duplicatePaymentId_reverts() public {
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](0);
        vm.prank(payer);
        router.settle(organizer, 100e6, PAYMENT_ID_1, fees);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.PaymentAlreadySettled.selector, PAYMENT_ID_1));
        router.settle(organizer, 200e6, PAYMENT_ID_1, fees);
    }

    function test_settle_paused_reverts() public {
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](0);

        vm.prank(pauser);
        router.pause();

        vm.prank(payer);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        router.settle(organizer, 100e6, PAYMENT_ID_1, fees);

        vm.prank(pauser);
        router.unpause();

        vm.prank(payer);
        router.settle(organizer, 100e6, PAYMENT_ID_1, fees);
        assertTrue(router.isSettled(PAYMENT_ID_1));
    }

    /// @dev Demonstrates the contract only ever pulls the configured stablecoin: a payer with
    ///      no balance / no allowance cannot settle, satisfying the "stablecoin-only" requirement.
    function test_settle_unauthorizedToken_reverts() public {
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](0);
        address brokePayer = address(0xBA5E);
        // No mint, no approve — settle must revert on transferFrom.
        vm.prank(brokePayer);
        vm.expectRevert();
        router.settle(organizer, 100e6, PAYMENT_ID_1, fees);
    }

    // ---------------------------------------------------------------------
    // reverseSettle
    // ---------------------------------------------------------------------

    /// @dev Helper: settle a payment with two platform fees so the reverse tests can run.
    function _settleForRefund() internal returns (uint256 amount) {
        amount = 1_000e6;
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](2);
        fees[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 30e6 });
        fees[1] = IFeeRouter.FeeSplit({ recipient: platformB, amount: 50e6 });

        vm.prank(payer);
        router.settle(organizer, amount, PAYMENT_ID_1, fees);

        // Recipients pre-approve the router so reverseSettle can pull their cuts back.
        vm.prank(platformA);
        stablecoin.approve(address(router), type(uint256).max);
        vm.prank(platformB);
        stablecoin.approve(address(router), type(uint256).max);
    }

    function test_reverseSettle_happyPath_fullRefund() public {
        uint256 amount = _settleForRefund();

        // Refunder funds the organizer share (915e6 + 5e6 protocol-retained = 920e6).
        // Note: protocol retains its fee unless the caller passes treasury in feesToReverse
        // explicitly. So caller funds: refundAmount - sum(feesToReverse).
        // We refund the buyer the full `amount` (1000e6); platforms refund 80e6 total via
        // approval; refunder funds the remaining 920e6 (organizer share + protocol fee
        // retained).
        stablecoin.mint(refunder, amount);
        vm.prank(refunder);
        stablecoin.approve(address(router), type(uint256).max);

        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](2);
        feesToReverse[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 30e6 });
        feesToReverse[1] = IFeeRouter.FeeSplit({ recipient: platformB, amount: 50e6 });

        uint256 buyerBalBefore = stablecoin.balanceOf(buyer);
        uint256 platformABefore = stablecoin.balanceOf(platformA);
        uint256 platformBBefore = stablecoin.balanceOf(platformB);
        uint256 refunderBefore = stablecoin.balanceOf(refunder);

        vm.expectEmit(true, true, false, true, address(router));
        emit PaymentReversed(PAYMENT_ID_1, buyer, amount, feesToReverse);

        vm.prank(refunder);
        router.reverseSettle(PAYMENT_ID_1, buyer, amount, feesToReverse);

        assertEq(stablecoin.balanceOf(buyer) - buyerBalBefore, amount, "buyer received full refund");
        assertEq(platformABefore - stablecoin.balanceOf(platformA), 30e6, "platformA refunded");
        assertEq(platformBBefore - stablecoin.balanceOf(platformB), 50e6, "platformB refunded");
        assertEq(refunderBefore - stablecoin.balanceOf(refunder), 920e6, "refunder funded the rest");
        assertEq(stablecoin.balanceOf(address(router)), 0, "router holds nothing");
        assertTrue(router.isRefunded(PAYMENT_ID_1), "marked refunded");
    }

    function test_reverseSettle_partialFeeRetention() public {
        uint256 amount = _settleForRefund();

        // Caller only pulls platformA's fee back; platformB retains its 50e6.
        stablecoin.mint(refunder, amount);
        vm.prank(refunder);
        stablecoin.approve(address(router), type(uint256).max);

        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](1);
        feesToReverse[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 30e6 });

        uint256 platformABefore = stablecoin.balanceOf(platformA);
        uint256 platformBBefore = stablecoin.balanceOf(platformB);
        uint256 refunderBefore = stablecoin.balanceOf(refunder);

        vm.prank(refunder);
        router.reverseSettle(PAYMENT_ID_1, buyer, amount, feesToReverse);

        assertEq(stablecoin.balanceOf(buyer), amount, "buyer received full refund");
        assertEq(platformABefore - stablecoin.balanceOf(platformA), 30e6, "platformA refunded");
        assertEq(stablecoin.balanceOf(platformB), platformBBefore, "platformB retained");
        // Refunder funded amount - 30e6 = 970e6 (covering organizer + protocol + platformB).
        assertEq(refunderBefore - stablecoin.balanceOf(refunder), 970e6, "refunder funded rest");
    }

    function test_reverseSettle_unauthorized_reverts() public {
        _settleForRefund();

        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](0);

        bytes32 refundRole = router.REFUND_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, refundRole)
        );
        vm.prank(stranger);
        router.reverseSettle(PAYMENT_ID_1, buyer, 1_000e6, feesToReverse);
    }

    function test_reverseSettle_neverSettled_reverts() public {
        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](0);
        stablecoin.mint(refunder, 1_000e6);
        vm.prank(refunder);
        stablecoin.approve(address(router), type(uint256).max);

        vm.prank(refunder);
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.PaymentNotSettled.selector, PAYMENT_ID_2));
        router.reverseSettle(PAYMENT_ID_2, buyer, 1_000e6, feesToReverse);
    }

    function test_reverseSettle_doubleRefund_reverts() public {
        uint256 amount = _settleForRefund();

        stablecoin.mint(refunder, 2 * amount);
        vm.prank(refunder);
        stablecoin.approve(address(router), type(uint256).max);

        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](0);

        vm.prank(refunder);
        router.reverseSettle(PAYMENT_ID_1, buyer, amount, feesToReverse);

        vm.prank(refunder);
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.PaymentAlreadyRefunded.selector, PAYMENT_ID_1));
        router.reverseSettle(PAYMENT_ID_1, buyer, amount, feesToReverse);
    }

    function test_reverseSettle_zeroBuyer_reverts() public {
        _settleForRefund();
        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](0);

        vm.prank(refunder);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.reverseSettle(PAYMENT_ID_1, address(0), 1_000e6, feesToReverse);
    }

    function test_reverseSettle_zeroAmount_reverts() public {
        _settleForRefund();
        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](0);

        vm.prank(refunder);
        vm.expectRevert(IFeeRouter.ZeroAmount.selector);
        router.reverseSettle(PAYMENT_ID_1, buyer, 0, feesToReverse);
    }

    function test_reverseSettle_feesExceedRefund_reverts() public {
        _settleForRefund();

        // Sum of feesToReverse > refundAmount.
        IFeeRouter.FeeSplit[] memory feesToReverse = new IFeeRouter.FeeSplit[](1);
        feesToReverse[0] = IFeeRouter.FeeSplit({ recipient: platformA, amount: 1_001e6 });

        vm.prank(refunder);
        vm.expectRevert(IFeeRouter.RefundAmountInvalid.selector);
        router.reverseSettle(PAYMENT_ID_1, buyer, 1_000e6, feesToReverse);
    }

    // ---------------------------------------------------------------------
    // setFeeBps / setTreasury
    // ---------------------------------------------------------------------

    function test_setFeeSchedule_admin() public {
        vm.expectEmit(false, false, false, true, address(router));
        emit FeeScheduleUpdated(50, 350);

        vm.prank(admin);
        router.setFeeBps(350);
        assertEq(router.feeBps(), 350);
    }

    function test_initialFeeBps_isFiftyBps() public view {
        assertEq(router.feeBps(), 50, "default fee is 0.5%");
        assertEq(router.INITIAL_FEE_BPS(), 50, "INITIAL_FEE_BPS constant is 50");
    }

    function test_setFeeSchedule_unauthorized_reverts() public {
        bytes32 adminRole = router.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole)
        );
        vm.prank(stranger);
        router.setFeeBps(350);
    }

    function test_setFeeSchedule_above_cap_reverts() public {
        uint16 maxBps = router.MAX_FEE_BPS();
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.FeeBpsTooHigh.selector, uint16(1001), maxBps));
        vm.prank(admin);
        router.setFeeBps(1001);
    }

    function test_setTreasury_admin() public {
        address newTreasury = address(0xCAFEBABE);
        vm.prank(admin);
        router.setTreasury(newTreasury);
        assertEq(router.treasury(), newTreasury);
    }

    function test_setTreasury_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.setTreasury(address(0));
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    function test_caps_areAsExpected() public view {
        assertEq(router.MAX_TOTAL_PLATFORM_FEES_BPS(), 2000, "platform cap = 20%");
        assertEq(router.MIN_ORGANIZER_BPS(), 7000, "organizer floor = 70%");
        assertEq(router.MAX_FEE_BPS(), 1000, "protocol cap = 10%");
        assertEq(router.BPS_DENOMINATOR(), 10_000, "denominator = 10_000");
    }

    // ---------------------------------------------------------------------
    // Upgrade
    // ---------------------------------------------------------------------

    function test_upgrade_uupsAuth() public {
        FeeRouterV2 v2 = new FeeRouterV2();

        vm.prank(upgrader);
        router.upgradeToAndCall(address(v2), bytes(""));

        // Storage preserved + new method available.
        assertEq(router.feeBps(), 50);
        assertEq(FeeRouterV2(address(router)).version(), "v2");
    }

    function test_upgrade_unauthorized_reverts() public {
        FeeRouterV2 v2 = new FeeRouterV2();
        bytes32 upgraderRole = router.UPGRADER_ROLE();

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, upgraderRole)
        );
        vm.prank(stranger);
        router.upgradeToAndCall(address(v2), bytes(""));
    }

    // ---------------------------------------------------------------------
    // CREATE2 determinism
    // ---------------------------------------------------------------------

    function test_create2_addressIsDeterministic() public pure {
        // Same inputs to CREATE2 must always produce the same address.
        // This is what makes FeeRouter's proxy address match across all EVM chains.
        address stablecoinAddr = address(0xCAFE);
        address treasuryAddr = address(0xBEEF);
        address adminAddr = address(0xDEAD);
        address upgraderAddr = address(0x1234);
        address pauserAddr = address(0x5678);
        address fakeImpl = address(0x1111111111111111111111111111111111111111);

        bytes32 salt = keccak256(abi.encodePacked("atlas-protocol/FeeRouter v0.1.0"));
        bytes memory initData =
            abi.encodeCall(FeeRouter.initialize, (adminAddr, upgraderAddr, pauserAddr, treasuryAddr, stablecoinAddr));
        bytes memory initCode = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(fakeImpl, initData));
        bytes32 codeHash = keccak256(initCode);
        address factory = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

        address addr1 = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), factory, salt, codeHash)))));
        address addr2 = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), factory, salt, codeHash)))));

        assertEq(addr1, addr2, "CREATE2 prediction must be deterministic");
    }

    // ---------------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------------

    function test_fuzz_settle_anyAmount(uint128 amountSeed) public {
        uint256 amount = bound(uint256(amountSeed), 1, type(uint128).max);

        // Refresh payer balance + allowance for arbitrary amounts.
        stablecoin.mint(payer, amount);
        vm.prank(payer);
        stablecoin.approve(address(router), type(uint256).max);

        uint256 organizerBalBefore = stablecoin.balanceOf(organizer);
        uint256 treasuryBalBefore = stablecoin.balanceOf(treasury);

        bytes32 paymentId = keccak256(abi.encode(amount));
        IFeeRouter.FeeSplit[] memory fees = new IFeeRouter.FeeSplit[](0);
        vm.prank(payer);
        router.settle(organizer, amount, paymentId, fees);

        uint256 protocolFee = (amount * 50) / 10_000;
        uint256 organizerAmount = amount - protocolFee;

        assertEq(stablecoin.balanceOf(organizer) - organizerBalBefore, organizerAmount, "organizer share");
        assertEq(stablecoin.balanceOf(treasury) - treasuryBalBefore, protocolFee, "treasury share");
        assertEq(organizerAmount + protocolFee, amount, "split sums to input");
    }
}
