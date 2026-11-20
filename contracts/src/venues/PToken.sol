// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title PToken
/// @notice Synthetic stock token ("Pantado <Name>", symbol p<SYMBOL>), 18 decimals. Minted and burned only by
///         its StockVenue (spec §4, §6).
contract PToken is ERC20 {
    address public immutable venue;

    error OnlyVenue();

    constructor(string memory name_, string memory symbol_, address venue_) ERC20(name_, symbol_) {
        venue = venue_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != venue) revert OnlyVenue();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != venue) revert OnlyVenue();
        _burn(from, amount);
    }
}
