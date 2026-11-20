// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestERC20} from "./TestERC20.sol";

/// @title TestUSDC
/// @notice 6-decimal test quote token (Fuji / Anvil only).
contract TestUSDC is TestERC20 {
    constructor(address owner_) TestERC20("Test USD Coin", "USDC", 6, owner_) {}
}
