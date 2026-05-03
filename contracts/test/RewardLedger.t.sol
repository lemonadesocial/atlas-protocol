// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { RewardLedger } from "../src/RewardLedger.sol";
import { IRewardLedger } from "../src/interfaces/IRewardLedger.sol";
import { MockStablecoin } from "./utils/MockStablecoin.sol";

/// @dev Helper used by the upgrade authorization test.
contract RewardLedgerV2 is RewardLedger {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract RewardLedgerTest is Test {
    RewardLedger internal ledger;
    MockStablecoin internal stablecoin;

    address internal admin = address(0xA11CE);
    address internal recorder = address(0xB0B);
    address internal pauser = address(0xCAFE);
    address internal upgrader = address(0xBEEF);
    address internal recipient1 = address(0xD00D);
    address internal recipient2 = address(0xF00D);
    address internal payer = address(0xC0DE);
    address internal stranger = address(0xDEAD);

    bytes32 internal constant PAYMENT_ID_1 = keccak256("payment-1");
    bytes32 internal constant PAYMENT_ID_2 = keccak256("payment-2");

    event RewardRecorded(
        bytes32 indexed paymentId,
        address indexed recipient,
        IRewardLedger.RewardKind indexed kind,
        uint256 amount
    );
    event Claimed(address indexed claimer, address indexed destination, uint256 amount);
    event Funded(address indexed from, uint256 amount);

    function setUp() public {
        stablecoin = new MockStablecoin();

        RewardLedger impl = new RewardLedger();
        bytes memory initData =
            abi.encodeCall(RewardLedger.initialize, (admin, recorder, pauser, upgrader, address(stablecoin)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        ledger = RewardLedger(address(proxy));

        // Mint payer a balance and approve the ledger so fund() works without setup boilerplate
        // inside each test.
        stablecoin.mint(payer, 1_000_000e6);
        vm.prank(payer);
        stablecoin.approve(address(ledger), type(uint256).max);
    }

    /// @dev Top up the ledger so claim tests have stablecoin to transfer out.
    function _fundLedger(uint256 amount) internal {
        vm.prank(payer);
        ledger.fund(amount);
    }

    // ---------------------------------------------------------------------
    // recordReward
    // ---------------------------------------------------------------------

    function test_recordReward_happyPath() public {
        vm.expectEmit(true, true, true, true, address(ledger));
        emit RewardRecorded(PAYMENT_ID_1, recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6);

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        assertEq(ledger.balanceOf(recipient1), 100e6, "balance credited");
        assertTrue(ledger.isRecorded(PAYMENT_ID_1, IRewardLedger.RewardKind.ORGANIZER), "marked recorded");
        assertFalse(
            ledger.isRecorded(PAYMENT_ID_1, IRewardLedger.RewardKind.ATTENDEE),
            "different kind same paymentId not flipped"
        );
    }

    function test_recordReward_accumulates() public {
        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 250e6, PAYMENT_ID_2);

        assertEq(ledger.balanceOf(recipient1), 350e6, "balances sum");
    }

    function test_recordReward_duplicateKey_reverts() public {
        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        vm.prank(recorder);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRewardLedger.RewardAlreadyRecorded.selector, PAYMENT_ID_1, IRewardLedger.RewardKind.ORGANIZER
            )
        );
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);
    }

    function test_recordReward_differentKindSamePaymentId_allowed() public {
        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 60e6, PAYMENT_ID_1);

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ATTENDEE, 40e6, PAYMENT_ID_1);

        assertEq(ledger.balanceOf(recipient1), 100e6, "two kinds for same paymentId both credited");
        assertTrue(ledger.isRecorded(PAYMENT_ID_1, IRewardLedger.RewardKind.ORGANIZER), "ORGANIZER recorded");
        assertTrue(ledger.isRecorded(PAYMENT_ID_1, IRewardLedger.RewardKind.ATTENDEE), "ATTENDEE recorded");
        assertFalse(ledger.isRecorded(PAYMENT_ID_1, IRewardLedger.RewardKind.REFERRAL), "REFERRAL untouched");
    }

    function test_recordReward_zeroRecipient_reverts() public {
        vm.prank(recorder);
        vm.expectRevert(IRewardLedger.ZeroAddress.selector);
        ledger.recordReward(address(0), IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);
    }

    function test_recordReward_zeroAmount_reverts() public {
        vm.prank(recorder);
        vm.expectRevert(IRewardLedger.ZeroAmount.selector);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 0, PAYMENT_ID_1);
    }

    function test_recordReward_unauthorized_reverts() public {
        bytes32 recorderRole = ledger.RECORDER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, recorderRole)
        );
        vm.prank(stranger);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);
    }

    function test_recordReward_paused_reverts() public {
        vm.prank(pauser);
        ledger.pause();

        vm.prank(recorder);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        vm.prank(pauser);
        ledger.unpause();

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);
        assertEq(ledger.balanceOf(recipient1), 100e6, "record succeeds after unpause");
    }

    // ---------------------------------------------------------------------
    // claim / claimTo
    // ---------------------------------------------------------------------

    function test_claim_happyPath() public {
        _fundLedger(100e6);

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        uint256 ledgerBalBefore = stablecoin.balanceOf(address(ledger));
        uint256 recipientBalBefore = stablecoin.balanceOf(recipient1);

        vm.expectEmit(true, true, false, true, address(ledger));
        emit Claimed(recipient1, recipient1, 100e6);

        vm.prank(recipient1);
        uint256 returned = ledger.claim();

        assertEq(returned, 100e6, "claim returns amount");
        assertEq(ledger.balanceOf(recipient1), 0, "accrued balance zeroed");
        assertEq(stablecoin.balanceOf(recipient1) - recipientBalBefore, 100e6, "recipient received USDC");
        assertEq(ledgerBalBefore - stablecoin.balanceOf(address(ledger)), 100e6, "ledger paid out USDC");
    }

    function test_claim_noBalance_reverts() public {
        vm.prank(recipient1);
        vm.expectRevert(IRewardLedger.NoBalance.selector);
        ledger.claim();
    }

    function test_claim_paused_reverts() public {
        _fundLedger(100e6);
        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        vm.prank(pauser);
        ledger.pause();

        vm.prank(recipient1);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        ledger.claim();
    }

    function test_claimTo_destination_receivesUSDC() public {
        _fundLedger(100e6);

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        uint256 destBalBefore = stablecoin.balanceOf(recipient2);

        vm.expectEmit(true, true, false, true, address(ledger));
        emit Claimed(recipient1, recipient2, 100e6);

        vm.prank(recipient1);
        uint256 returned = ledger.claimTo(recipient2);

        assertEq(returned, 100e6, "claimTo returns amount");
        assertEq(stablecoin.balanceOf(recipient2) - destBalBefore, 100e6, "destination received USDC");
        assertEq(stablecoin.balanceOf(recipient1), 0, "claimer wallet untouched");
        assertEq(ledger.balanceOf(recipient1), 0, "claimer accrued balance zeroed");
    }

    function test_claimTo_zeroDestination_reverts() public {
        _fundLedger(100e6);
        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        vm.prank(recipient1);
        vm.expectRevert(IRewardLedger.ZeroAddress.selector);
        ledger.claimTo(address(0));
    }

    /// @dev Sanity-checks effects-before-interactions: a second claim immediately reverts
    ///      NoBalance because the first claim zeroed the accrued balance before transfer.
    function test_claimTo_resetsBalanceBeforeTransfer() public {
        _fundLedger(100e6);
        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        vm.prank(recipient1);
        ledger.claimTo(recipient2);

        vm.prank(recipient1);
        vm.expectRevert(IRewardLedger.NoBalance.selector);
        ledger.claimTo(recipient2);
    }

    // ---------------------------------------------------------------------
    // fund
    // ---------------------------------------------------------------------

    function test_fund_increasesContractBalance() public {
        uint256 ledgerBalBefore = stablecoin.balanceOf(address(ledger));
        uint256 payerBalBefore = stablecoin.balanceOf(payer);

        vm.expectEmit(true, false, false, true, address(ledger));
        emit Funded(payer, 500e6);

        vm.prank(payer);
        ledger.fund(500e6);

        assertEq(stablecoin.balanceOf(address(ledger)) - ledgerBalBefore, 500e6, "ledger balance increased");
        assertEq(payerBalBefore - stablecoin.balanceOf(payer), 500e6, "payer balance decreased");
    }

    function test_fund_zeroAmount_reverts() public {
        vm.prank(payer);
        vm.expectRevert(IRewardLedger.ZeroAmount.selector);
        ledger.fund(0);
    }

    // ---------------------------------------------------------------------
    // Upgrade
    // ---------------------------------------------------------------------

    function test_upgrade_uupsAuth() public {
        // Record a reward + fund before upgrade so we can prove storage survives.
        _fundLedger(100e6);
        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, 100e6, PAYMENT_ID_1);

        RewardLedgerV2 v2 = new RewardLedgerV2();
        vm.prank(upgrader);
        ledger.upgradeToAndCall(address(v2), bytes(""));

        assertEq(ledger.balanceOf(recipient1), 100e6, "balance persists across upgrade");
        assertTrue(
            ledger.isRecorded(PAYMENT_ID_1, IRewardLedger.RewardKind.ORGANIZER),
            "isRecorded persists across upgrade"
        );
        assertEq(ledger.stablecoin(), address(stablecoin), "stablecoin persists across upgrade");
        assertEq(RewardLedgerV2(address(ledger)).version(), "v2", "v2 method exposed");

        // Existing recipient can still claim after the upgrade.
        vm.prank(recipient1);
        uint256 returned = ledger.claim();
        assertEq(returned, 100e6, "claim works after upgrade");
        assertEq(ledger.balanceOf(recipient1), 0, "balance zeroed after claim");
    }

    function test_upgrade_unauthorized_reverts() public {
        RewardLedgerV2 v2 = new RewardLedgerV2();
        bytes32 upgraderRole = ledger.UPGRADER_ROLE();

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, upgraderRole)
        );
        vm.prank(stranger);
        ledger.upgradeToAndCall(address(v2), bytes(""));
    }

    // ---------------------------------------------------------------------
    // CREATE2 determinism
    // ---------------------------------------------------------------------

    function test_create2_addressIsDeterministic() public pure {
        // Same inputs to CREATE2 must always produce the same address.
        // This is what makes RewardLedger's proxy address match across all EVM chains
        // when the same role multisigs and stablecoin choice are used.
        address adminAddr = address(0xDEAD);
        address recorderAddr = address(0x1234);
        address pauserAddr = address(0x5678);
        address upgraderAddr = address(0x9ABC);
        address stablecoinAddr = address(0xCAFE);
        address fakeImpl = address(0x1111111111111111111111111111111111111111);

        bytes32 salt = keccak256(abi.encodePacked("atlas-protocol/RewardLedger v0.1.0"));
        bytes memory initData = abi.encodeCall(
            RewardLedger.initialize, (adminAddr, recorderAddr, pauserAddr, upgraderAddr, stablecoinAddr)
        );
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

    function test_fuzz_recordAccumulates(uint128[3] memory amounts) public {
        // Filter out the zero case — recordReward rejects zero amounts.
        vm.assume(amounts[0] > 0 && amounts[1] > 0 && amounts[2] > 0);

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ORGANIZER, amounts[0], keccak256("p1"));

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.ATTENDEE, amounts[1], keccak256("p2"));

        vm.prank(recorder);
        ledger.recordReward(recipient1, IRewardLedger.RewardKind.REFERRAL, amounts[2], keccak256("p3"));

        // uint128 + uint128 + uint128 cannot overflow uint256.
        uint256 expected = uint256(amounts[0]) + uint256(amounts[1]) + uint256(amounts[2]);
        assertEq(ledger.balanceOf(recipient1), expected, "three records sum without overflow");
    }
}
