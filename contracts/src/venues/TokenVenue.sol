// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {FixedPoint} from "../libraries/FixedPoint.sol";
import {IPriceOracle} from "../oracle/IPriceOracle.sol";
import {IVenue} from "./IVenue.sol";

/// @title TokenVenue
/// @notice Contest token legs on Fuji: swaps test tokens ↔ USDC at oracle price ± spreadBps from its own
///         inventory, so Fuji fills match the displayed mainnet prices (spec §7). Spread stays here.
contract TokenVenue is IVenue, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Market {
        bool listed;
        uint8 decimals;
        uint16 spreadBps;
    }

    IPriceOracle public immutable oracle;
    address public immutable usdc;
    uint8 public immutable usdcDecimals;
    mapping(address token => Market) public markets;

    event MarketSet(address indexed token, uint16 spreadBps);
    event Swapped(
        address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address to
    );
    event Withdrawn(address indexed token, uint256 amount, address to);

    error UnsupportedPair(address tokenIn, address tokenOut);
    error InsufficientInventory(address token, uint256 needed, uint256 available);
    error Slippage(uint256 got, uint256 min);
    error BadSpread();

    constructor(address owner_, address oracle_, address usdc_) Ownable(owner_) {
        oracle = IPriceOracle(oracle_);
        usdc = usdc_;
        usdcDecimals = IERC20Metadata(usdc_).decimals();
    }

    function setMarket(address token, uint16 spreadBps) external onlyOwner {
        if (spreadBps >= 10_000 || token == usdc) revert BadSpread();
        markets[token] = Market({listed: true, decimals: IERC20Metadata(token).decimals(), spreadBps: spreadBps});
        emit MarketSet(token, spreadBps);
    }

    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, amount, to);
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256 amountOut) {
        if (tokenIn == usdc) {
            Market memory m = markets[tokenOut];
            if (!m.listed) revert UnsupportedPair(tokenIn, tokenOut);
            uint256 price = oracle.getPrice(tokenOut);
            uint256 usd = FixedPoint.valueOf(amountIn, 1e18, usdcDecimals);
            uint256 net = FixedPoint.mulBps(usd, 10_000 - m.spreadBps);
            amountOut = FixedPoint.amountFor(net, price, m.decimals);
        } else if (tokenOut == usdc) {
            Market memory m = markets[tokenIn];
            if (!m.listed) revert UnsupportedPair(tokenIn, tokenOut);
            uint256 price = oracle.getPrice(tokenIn);
            uint256 usd = FixedPoint.valueOf(amountIn, price, m.decimals);
            uint256 net = FixedPoint.mulBps(usd, 10_000 - m.spreadBps);
            amountOut = FixedPoint.amountFor(net, 1e18, usdcDecimals);
        } else {
            revert UnsupportedPair(tokenIn, tokenOut);
        }
        uint256 avail = IERC20(tokenOut).balanceOf(address(this));
        if (amountOut > avail) revert InsufficientInventory(tokenOut, amountOut, avail);
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(to, amountOut);
        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }
}
