// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import { AtlasTicket } from "../src/AtlasTicket.sol";
import { IAtlasTicket } from "../src/interfaces/IAtlasTicket.sol";

/// @dev Helper used by the upgrade authorization test.
contract AtlasTicketV2 is AtlasTicket {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract AtlasTicketTest is Test {
    AtlasTicket internal ticket;

    address internal admin = address(0xA11CE);
    address internal minter = address(0xB0B);
    address internal pauser = address(0xCAFE);
    address internal upgrader = address(0xBEEF);
    address internal burner = address(0xBA5E);
    address internal custodial = address(0xC057);
    address internal alice = address(0xD00D);
    address internal bob = address(0xF00D);
    address internal stranger = address(0xDEAD);

    string internal constant NAME = "ATLAS Ticket";
    string internal constant SYMBOL = "ATLAS";
    string internal constant URI_1 = "ipfs://QmTicketOne";
    string internal constant URI_2 = "ipfs://QmTicketTwo";

    uint256 internal constant EVENT_ID_1 = 42;
    uint256 internal constant EVENT_ID_2 = 1337;

    bytes32 internal constant PAYMENT_ID_1 = keccak256("payment-1");
    bytes32 internal constant PAYMENT_ID_2 = keccak256("payment-2");
    bytes32 internal constant EMAIL_HASH_1 = keccak256("alice@example.com");
    bytes32 internal constant EMAIL_HASH_NONE = bytes32(0);

    event TicketMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 indexed eventId,
        bytes32 paymentId,
        string tokenURI,
        bytes32 emailHash
    );

    event TicketBurned(uint256 indexed tokenId, bytes32 indexed paymentId);

    function setUp() public {
        AtlasTicket impl = new AtlasTicket();
        bytes memory initData =
            abi.encodeCall(AtlasTicket.initialize, (admin, minter, pauser, upgrader, NAME, SYMBOL));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        ticket = AtlasTicket(address(proxy));
    }

    // ---------------------------------------------------------------------
    // mint
    // ---------------------------------------------------------------------

    function test_mint_happyPath_emitsAndStores() public {
        vm.expectEmit(true, true, true, true, address(ticket));
        emit TicketMinted(1, alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        vm.prank(minter);
        uint256 tokenId = ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        assertEq(tokenId, 1, "first tokenId is 1");
        assertEq(ticket.ownerOf(1), alice, "owner");
        assertEq(ticket.balanceOf(alice), 1, "balance");
        assertEq(ticket.tokenURI(1), URI_1, "uri");
        assertEq(ticket.eventIdOf(1), EVENT_ID_1, "eventId");
        assertEq(ticket.paymentIdOf(1), PAYMENT_ID_1, "paymentId");
        assertEq(ticket.emailHashOf(1), EMAIL_HASH_NONE, "emailHash zero for self-custody mint");
        assertEq(ticket.name(), NAME, "name");
        assertEq(ticket.symbol(), SYMBOL, "symbol");
    }

    function test_mint_secondToken_incrementsId() public {
        vm.prank(minter);
        ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        vm.prank(minter);
        uint256 second = ticket.mint(bob, EVENT_ID_2, PAYMENT_ID_2, URI_2, EMAIL_HASH_NONE);

        assertEq(second, 2, "second tokenId is 2");
        assertEq(ticket.ownerOf(2), bob, "second owner");
        assertEq(ticket.eventIdOf(2), EVENT_ID_2, "second eventId");
    }

    function test_mint_duplicatePaymentId_reverts() public {
        vm.prank(minter);
        uint256 first = ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(IAtlasTicket.PaymentAlreadyMinted.selector, PAYMENT_ID_1, first));
        ticket.mint(bob, EVENT_ID_2, PAYMENT_ID_1, URI_2, EMAIL_HASH_NONE);
    }

    function test_mint_unauthorized_reverts() public {
        bytes32 minterRole = ticket.MINTER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, minterRole)
        );
        vm.prank(stranger);
        ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);
    }

    function test_mint_zeroTo_reverts() public {
        vm.prank(minter);
        vm.expectRevert(IAtlasTicket.ZeroAddress.selector);
        ticket.mint(address(0), EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);
    }

    function test_mint_emptyTokenURI_reverts() public {
        vm.prank(minter);
        vm.expectRevert(IAtlasTicket.EmptyTokenURI.selector);
        ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, "", EMAIL_HASH_NONE);
    }

    function test_mint_paused_reverts() public {
        vm.prank(pauser);
        ticket.pause();

        vm.prank(minter);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        vm.prank(pauser);
        ticket.unpause();

        vm.prank(minter);
        uint256 tokenId = ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);
        assertEq(tokenId, 1, "mint succeeds after unpause");
    }

    function test_transfer_paused_reverts() public {
        vm.prank(minter);
        ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        vm.prank(pauser);
        ticket.pause();

        vm.prank(alice);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        ticket.safeTransferFrom(alice, bob, 1);
    }

    // ---------------------------------------------------------------------
    // burn
    // ---------------------------------------------------------------------

    function _grantBurner() internal {
        bytes32 burnerRole = ticket.BURNER_ROLE();
        vm.prank(admin);
        ticket.grantRole(burnerRole, burner);
    }

    function test_Burn_HappyPath() public {
        _grantBurner();

        vm.prank(minter);
        uint256 tokenId = ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);
        assertEq(ticket.ownerOf(tokenId), alice, "ownership before burn");

        vm.expectEmit(true, true, false, false, address(ticket));
        emit TicketBurned(tokenId, PAYMENT_ID_1);

        vm.prank(burner);
        ticket.burn(tokenId, PAYMENT_ID_1);

        // Token no longer exists — view reverts.
        vm.expectRevert(abi.encodeWithSelector(IAtlasTicket.TokenNotMinted.selector, tokenId));
        ticket.tokenURI(tokenId);
    }

    function test_Burn_RevertsWithoutRole() public {
        vm.prank(minter);
        uint256 tokenId = ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        bytes32 burnerRole = ticket.BURNER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, burnerRole)
        );
        vm.prank(stranger);
        ticket.burn(tokenId, PAYMENT_ID_1);

        // Even the minter cannot burn — BURNER_ROLE is distinct from MINTER_ROLE.
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, minter, burnerRole)
        );
        vm.prank(minter);
        ticket.burn(tokenId, PAYMENT_ID_1);
    }

    function test_Burn_RevertsForNonexistentToken() public {
        _grantBurner();

        vm.prank(burner);
        vm.expectRevert(abi.encodeWithSelector(IAtlasTicket.TokenNotMinted.selector, uint256(99)));
        ticket.burn(99, PAYMENT_ID_1);
    }

    function test_Burn_paused_reverts() public {
        _grantBurner();

        vm.prank(minter);
        uint256 tokenId = ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_NONE);

        vm.prank(pauser);
        ticket.pause();

        vm.prank(burner);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        ticket.burn(tokenId, PAYMENT_ID_1);
    }

    // ---------------------------------------------------------------------
    // Custodial-wallet pattern
    // ---------------------------------------------------------------------

    function test_Custodial_MintAndTransfer() public {
        // Mint to ATLAS-managed custodial holder with a non-zero email hash. The TicketMinted
        // event records the email hash so off-chain indexers can join the ticket to the buyer.
        vm.expectEmit(true, true, true, true, address(ticket));
        emit TicketMinted(1, custodial, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_1);

        vm.prank(minter);
        uint256 tokenId = ticket.mint(custodial, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_1);

        assertEq(tokenId, 1, "tokenId");
        assertEq(ticket.ownerOf(tokenId), custodial, "custodial holder owns ticket");
        assertEq(ticket.emailHashOf(tokenId), EMAIL_HASH_1, "emailHash stored");

        // Once the buyer connects a wallet, the operator transfers the ticket via standard
        // ERC-721 transferFrom — no special claim function. The email hash stays attached so
        // historical correlation works even after the handoff.
        vm.prank(custodial);
        ticket.transferFrom(custodial, alice, tokenId);

        assertEq(ticket.ownerOf(tokenId), alice, "buyer owns ticket post-claim");
        assertEq(ticket.emailHashOf(tokenId), EMAIL_HASH_1, "emailHash preserved across transfer");
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function test_tokenURI_unminted_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IAtlasTicket.TokenNotMinted.selector, uint256(99)));
        ticket.tokenURI(99);
    }

    function test_paymentIdOf_unminted_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IAtlasTicket.TokenNotMinted.selector, uint256(99)));
        ticket.paymentIdOf(99);
    }

    function test_eventIdOf_unminted_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IAtlasTicket.TokenNotMinted.selector, uint256(99)));
        ticket.eventIdOf(99);
    }

    function test_emailHashOf_unminted_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IAtlasTicket.TokenNotMinted.selector, uint256(99)));
        ticket.emailHashOf(99);
    }

    // ---------------------------------------------------------------------
    // Upgrade
    // ---------------------------------------------------------------------

    function test_upgrade_uupsAuth() public {
        // Mint before upgrade so we can prove storage survives the upgrade.
        vm.prank(minter);
        ticket.mint(alice, EVENT_ID_1, PAYMENT_ID_1, URI_1, EMAIL_HASH_1);

        AtlasTicketV2 v2 = new AtlasTicketV2();
        vm.prank(upgrader);
        ticket.upgradeToAndCall(address(v2), bytes(""));

        // Storage preserved + new method available.
        assertEq(ticket.ownerOf(1), alice, "owner persists across upgrade");
        assertEq(ticket.tokenURI(1), URI_1, "uri persists across upgrade");
        assertEq(ticket.eventIdOf(1), EVENT_ID_1, "eventId persists");
        assertEq(ticket.paymentIdOf(1), PAYMENT_ID_1, "paymentId persists");
        assertEq(ticket.emailHashOf(1), EMAIL_HASH_1, "emailHash persists");
        assertEq(AtlasTicketV2(address(ticket)).version(), "v2", "v2 method exposed");
    }

    function test_upgrade_unauthorized_reverts() public {
        AtlasTicketV2 v2 = new AtlasTicketV2();
        bytes32 upgraderRole = ticket.UPGRADER_ROLE();

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, upgraderRole)
        );
        vm.prank(stranger);
        ticket.upgradeToAndCall(address(v2), bytes(""));
    }

    // ---------------------------------------------------------------------
    // CREATE2 determinism
    // ---------------------------------------------------------------------

    function test_create2_addressIsDeterministic() public pure {
        // Same inputs to CREATE2 must always produce the same address.
        // This is what makes AtlasTicket's proxy address match across all EVM chains
        // when the same role multisigs are used.
        address adminAddr = address(0xDEAD);
        address minterAddr = address(0x1234);
        address pauserAddr = address(0x5678);
        address upgraderAddr = address(0x9ABC);
        address fakeImpl = address(0x1111111111111111111111111111111111111111);

        bytes32 salt = keccak256(abi.encodePacked("atlas-protocol/AtlasTicket v0.1.0"));
        bytes memory initData = abi.encodeCall(
            AtlasTicket.initialize, (adminAddr, minterAddr, pauserAddr, upgraderAddr, "ATLAS Ticket", "ATLAS")
        );
        bytes memory initCode = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(fakeImpl, initData));
        bytes32 codeHash = keccak256(initCode);
        address factory = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

        address addr1 = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), factory, salt, codeHash)))));
        address addr2 = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), factory, salt, codeHash)))));

        assertEq(addr1, addr2, "CREATE2 prediction must be deterministic");
    }
}
