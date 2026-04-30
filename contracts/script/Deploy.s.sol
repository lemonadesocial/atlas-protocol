// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {FeeRouter} from "../src/FeeRouter.sol";

/// @title Deploy
/// @notice Deploys the FeeRouter implementation and an ERC1967 proxy initialized with values
///         supplied via environment variables.
/// @dev Required env vars:
///        ATLAS_USDC_ADDRESS  - USDC token address on the target chain
///        ATLAS_TREASURY      - Treasury address that receives the protocol fee
///        ATLAS_ADMIN         - DEFAULT_ADMIN_ROLE recipient
///        ATLAS_UPGRADER      - UPGRADER_ROLE recipient
///        ATLAS_PAUSER        - PAUSER_ROLE recipient
contract Deploy is Script {
    function run() external returns (address proxy) {
        address usdc = vm.envAddress("ATLAS_USDC_ADDRESS");
        address treasury = vm.envAddress("ATLAS_TREASURY");
        address admin = vm.envAddress("ATLAS_ADMIN");
        address upgrader = vm.envAddress("ATLAS_UPGRADER");
        address pauser = vm.envAddress("ATLAS_PAUSER");

        vm.startBroadcast();

        FeeRouter impl = new FeeRouter();
        bytes memory initData =
            abi.encodeCall(FeeRouter.initialize, (admin, upgrader, pauser, treasury, usdc));
        ERC1967Proxy proxyInstance = new ERC1967Proxy(address(impl), initData);

        vm.stopBroadcast();

        proxy = address(proxyInstance);
        console2.log("FeeRouter implementation:", address(impl));
        console2.log("FeeRouter proxy:", proxy);
        console2.log("USDC:", usdc);
        console2.log("Treasury:", treasury);
    }
}
