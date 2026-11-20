// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IIndexRegistry} from "../core/IIndexRegistry.sol";

/// @title FeeSplitter
/// @notice Splits index trade fees: protocolBps to the treasury, creatorBps accrued for the creator (spec §5.5).
///         Private indexes: the creator share goes to the protocol. Creators claim their accrued USDC.
contract FeeSplitter is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    uint16 public immutable protocolBps;
    uint16 public immutable creatorBps;
    IIndexRegistry public registry;
    address public treasury;

    mapping(address creator => uint256) public earnings;
    uint256 public totalOwed;

    event RegistrySet(address registry);
    event TreasurySet(address treasury);
    event FeeAccrued(address indexed index, address indexed creator, uint256 protocolAmount, uint256 creatorAmount);
    event Claimed(address indexed creator, address indexed to, uint256 amount);

    error NotIndex(address caller);
    error RegistryAlreadySet();
    error ZeroAddress();
    error InsufficientFunds();

    constructor(address owner_, address usdc_, address treasury_, uint16 protocolBps_, uint16 creatorBps_)
        Ownable(owner_)
    {
        if (usdc_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        treasury = treasury_;
        protocolBps = protocolBps_;
        creatorBps = creatorBps_;
    }

    function setRegistry(address registry_) external onlyOwner {
        if (address(registry) != address(0)) revert RegistryAlreadySet();
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IIndexRegistry(registry_);
        emit RegistrySet(registry_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Split of `fee`: (protocol, creator). Exact: protocol + creator == fee.
    function split(uint256 fee, bool isPublic) public view returns (uint256 protocolAmount, uint256 creatorAmount) {
        if (isPublic) creatorAmount = Math.mulDiv(fee, creatorBps, uint256(protocolBps) + creatorBps);
        protocolAmount = fee - creatorAmount;
    }

    /// @notice Called by an index vault right after it transferred `fee` USDC here.
    function accrue(uint256 fee) external {
        (address creator, bool isPublic, bool registered) = registry.indexInfo(msg.sender);
        if (!registered) revert NotIndex(msg.sender);
        (uint256 p, uint256 c) = split(fee, isPublic);
        if (usdc.balanceOf(address(this)) < totalOwed + fee) revert InsufficientFunds();
        if (c > 0) {
            earnings[creator] += c;
            totalOwed += c;
        }
        if (p > 0) usdc.safeTransfer(treasury, p);
        emit FeeAccrued(msg.sender, creator, p, c);
    }

    function claim(address to) external returns (uint256 amount) {
        amount = earnings[msg.sender];
        if (amount == 0) return 0;
        earnings[msg.sender] = 0;
        totalOwed -= amount;
        usdc.safeTransfer(to, amount);
        emit Claimed(msg.sender, to, amount);
    }
}
