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
    address internal treasury = address(0xBEEF);
    address internal organizer = address(0xD00D);
    address internal payer = address(0xF00D);
    address internal stranger = address(0xDEAD);

    bytes32 internal constant PAYMENT_ID_1 = keccak256("payment-1");
    bytes32 internal constant PAYMENT_ID_2 = keccak256("payment-2");

    event PaymentSettled(
        bytes32 indexed paymentId, address indexed organizer, uint256 organizerAmount, uint256 protocolFee
    );
    event FeeScheduleUpdated(uint16 oldBps, uint16 newBps);

    function setUp() public {
        stablecoin = new MockStablecoin();

        FeeRouter impl = new FeeRouter();
        bytes memory initData =
            abi.encodeCall(FeeRouter.initialize, (admin, upgrader, pauser, treasury, address(stablecoin)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = FeeRouter(address(proxy));

        stablecoin.mint(payer, 1_000_000e6);
        vm.prank(payer);
        stablecoin.approve(address(router), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // settle
    // ---------------------------------------------------------------------

    function test_settle_correctSplit_2pct() public {
        uint256 amount = 1_000e6;
        uint256 expectedFee = 20e6; // 2% of 1000
        uint256 expectedOrganizer = 980e6;

        vm.expectEmit(true, true, false, true, address(router));
        emit PaymentSettled(PAYMENT_ID_1, organizer, expectedOrganizer, expectedFee);

        vm.prank(payer);
        router.settle(organizer, amount, PAYMENT_ID_1);

        assertEq(stablecoin.balanceOf(organizer), expectedOrganizer, "organizer balance");
        assertEq(stablecoin.balanceOf(treasury), expectedFee, "treasury balance");
        assertEq(stablecoin.balanceOf(address(router)), 0, "router holds nothing");
        assertTrue(router.isSettled(PAYMENT_ID_1), "marked settled");
    }

    function test_settle_zeroAmount_reverts() public {
        vm.prank(payer);
        vm.expectRevert(IFeeRouter.ZeroAmount.selector);
        router.settle(organizer, 0, PAYMENT_ID_1);
    }

    function test_settle_zeroOrganizer_reverts() public {
        vm.prank(payer);
        vm.expectRevert(IFeeRouter.ZeroAddress.selector);
        router.settle(address(0), 100e6, PAYMENT_ID_1);
    }

    function test_settle_duplicatePaymentId_reverts() public {
        vm.prank(payer);
        router.settle(organizer, 100e6, PAYMENT_ID_1);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IFeeRouter.PaymentAlreadySettled.selector, PAYMENT_ID_1));
        router.settle(organizer, 200e6, PAYMENT_ID_1);
    }

    function test_settle_paused_reverts() public {
        vm.prank(pauser);
        router.pause();

        vm.prank(payer);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        router.settle(organizer, 100e6, PAYMENT_ID_1);

        vm.prank(pauser);
        router.unpause();

        vm.prank(payer);
        router.settle(organizer, 100e6, PAYMENT_ID_1);
        assertTrue(router.isSettled(PAYMENT_ID_1));
    }

    /// @dev Demonstrates the contract only ever pulls the configured stablecoin: a payer with
    ///      no balance / no allowance cannot settle, satisfying the "stablecoin-only" requirement.
    function test_settle_unauthorizedToken_reverts() public {
        address brokePayer = address(0xBA5E);
        // No mint, no approve — settle must revert on transferFrom.
        vm.prank(brokePayer);
        vm.expectRevert();
        router.settle(organizer, 100e6, PAYMENT_ID_1);
    }

    // ---------------------------------------------------------------------
    // setFeeBps / setTreasury
    // ---------------------------------------------------------------------

    function test_setFeeSchedule_admin() public {
        vm.expectEmit(false, false, false, true, address(router));
        emit FeeScheduleUpdated(200, 350);

        vm.prank(admin);
        router.setFeeBps(350);
        assertEq(router.feeBps(), 350);
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
    // Upgrade
    // ---------------------------------------------------------------------

    function test_upgrade_uupsAuth() public {
        FeeRouterV2 v2 = new FeeRouterV2();

        vm.prank(upgrader);
        router.upgradeToAndCall(address(v2), bytes(""));

        // Storage preserved + new method available.
        assertEq(router.feeBps(), 200);
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
        vm.prank(payer);
        router.settle(organizer, amount, paymentId);

        uint256 protocolFee = (amount * 200) / 10_000;
        uint256 organizerAmount = amount - protocolFee;

        assertEq(stablecoin.balanceOf(organizer) - organizerBalBefore, organizerAmount, "organizer share");
        assertEq(stablecoin.balanceOf(treasury) - treasuryBalBefore, protocolFee, "treasury share");
        assertEq(organizerAmount + protocolFee, amount, "split sums to input");
    }
}
