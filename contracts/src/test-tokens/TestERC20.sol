// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestERC20
/// @notice Test token for Fuji / Anvil only. Owner and approved minters can mint (auto-fund, seeding).
contract TestERC20 is ERC20, Ownable {
    uint8 private immutable _decimals;
    mapping(address => bool) public isMinter;

    event MinterSet(address indexed minter, bool allowed);

    error NotMinter(address caller);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner() && !isMinter[msg.sender]) revert NotMinter(msg.sender);
        _mint(to, amount);
    }
}
