// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {FixedPoint} from "../libraries/FixedPoint.sol";
import {AssetRegistry} from "../core/AssetRegistry.sol";
import {IVenue} from "../venues/IVenue.sol";

/// @title SwapRouter
/// @notice Single-asset swaps between any two registry assets through their venues, via USDC when needed
///         (spec §7.1). Fee `swapFeeBps` is taken in USDC on the USDC leg and sent to the treasury.
contract SwapRouter is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    AssetRegistry public immutable registry;
    IERC20 public immutable usdc;
    uint16 public swapFeeBps;
    address public treasury;

    event Swapped(
        address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee, address to
    );
    event FeeSet(uint16 swapFeeBps);
    event TreasurySet(address treasury);

    error NotListed(address token);
    error SameToken();
    error Slippage(uint256 got, uint256 min);
    error BadFee();
    error ZeroAddress();

    constructor(address owner_, address registry_, address treasury_, uint16 swapFeeBps_) Ownable(owner_) {
        if (registry_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (swapFeeBps_ > 1000) revert BadFee();
        registry = AssetRegistry(registry_);
        usdc = IERC20(AssetRegistry(registry_).quote());
        treasury = treasury_;
        swapFeeBps = swapFeeBps_;
    }

    function setFee(uint16 bps) external onlyOwner {
        if (bps > 1000) revert BadFee();
        swapFeeBps = bps;
        emit FeeSet(bps);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }

    /// @notice Output and fee of a swap right now; reverts like the swap would.
    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        public
        view
        returns (uint256 amountOut, uint256 fee)
    {
        _check(tokenIn, tokenOut);
        uint256 usdcAmt = tokenIn == address(usdc) ? amountIn : _venue(tokenIn).quote(tokenIn, address(usdc), amountIn);
        fee = FixedPoint.mulBps(usdcAmt, swapFeeBps);
        uint256 net = usdcAmt - fee;
        amountOut = tokenOut == address(usdc) ? net : _venue(tokenOut).quote(address(usdc), tokenOut, net);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        _check(tokenIn, tokenOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 usdcAmt = amountIn;
        if (tokenIn != address(usdc)) {
            IVenue v = _venue(tokenIn);
            IERC20(tokenIn).forceApprove(address(v), amountIn);
            usdcAmt = v.swapExactIn(tokenIn, address(usdc), amountIn, 0, address(this));
        }
        uint256 fee = FixedPoint.mulBps(usdcAmt, swapFeeBps);
        if (fee > 0) usdc.safeTransfer(treasury, fee);
        uint256 net = usdcAmt - fee;
        if (tokenOut == address(usdc)) {
            amountOut = net;
            if (amountOut < minOut) revert Slippage(amountOut, minOut);
            usdc.safeTransfer(to, amountOut);
        } else {
            IVenue v = _venue(tokenOut);
            usdc.forceApprove(address(v), net);
            amountOut = v.swapExactIn(address(usdc), tokenOut, net, minOut, to);
        }
        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee, to);
    }

    function _check(address a, address b) internal view {
        if (a == b) revert SameToken();
        if (a != address(usdc) && !registry.isListed(a)) revert NotListed(a);
        if (b != address(usdc) && !registry.isListed(b)) revert NotListed(b);
    }

    function _venue(address token) internal view returns (IVenue) {
        return IVenue(registry.venueOf(token));
    }
}
