// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockStablecoin
/// @notice 6-decimal ERC-20 used as a stablecoin stand-in inside Foundry tests.
///         Represents any 6-decimal stablecoin (USDC, USDP, USDm, etc.) for FeeRouter testing.
contract MockStablecoin is ERC20 {
    constructor() ERC20("Mock Stablecoin", "MOCK") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
