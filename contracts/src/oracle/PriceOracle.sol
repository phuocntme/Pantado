// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "./IPriceOracle.sol";

/// @notice Minimal Chainlink aggregator interface (optional source).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title PriceOracle
/// @notice Pushed prices with per-asset maxAge and bands (spec §5.10, §8). Fixed-price assets (USDC) never
///         go stale. An asset may instead read a Chainlink feed. Stale → `getPrice` reverts, which makes buy,
///         sell and auctions revert; redeem never reads prices.
contract PriceOracle is IPriceOracle, Ownable {
    struct Config {
        uint64 maxAgeSec; // 0 with fixedPrice = never stale
        bool fixedPrice;
        bool configured;
        uint256 bandMin;
        uint256 bandMax;
        address feed; // optional Chainlink aggregator; when set, pushes are rejected
    }

    struct Price {
        uint192 price;
        uint64 updatedAt;
    }

    mapping(address asset => Config) public configs;
    mapping(address asset => Price) internal _prices;
    mapping(address pusher => bool) public isPusher;

    event AssetConfigured(address indexed asset, uint64 maxAgeSec, uint256 bandMin, uint256 bandMax, bool fixedPrice);
    event FeedSet(address indexed asset, address feed);
    event PusherSet(address indexed pusher, bool allowed);
    event PricePushed(address indexed asset, uint256 price, uint256 timestamp);

    error NotPusher(address caller);
    error UnknownAsset(address asset);
    error PriceStale(address asset, uint256 updatedAt, uint256 maxAgeSec);
    error PriceOutOfBand(address asset, uint256 price, uint256 bandMin, uint256 bandMax);
    error FixedPriceAsset(address asset);
    error FeedAsset(address asset);
    error BadConfig();
    error LengthMismatch();

    constructor(address owner_) Ownable(owner_) {}

    // ---------------------------------------------------------------- admin

    function configureAsset(address asset, uint64 maxAgeSec, uint256 bandMin, uint256 bandMax) external onlyOwner {
        if (asset == address(0) || bandMin == 0 || bandMin > bandMax || maxAgeSec == 0) revert BadConfig();
        Config storage c = configs[asset];
        c.maxAgeSec = maxAgeSec;
        c.bandMin = bandMin;
        c.bandMax = bandMax;
        c.fixedPrice = false;
        c.configured = true;
        emit AssetConfigured(asset, maxAgeSec, bandMin, bandMax, false);
    }

    /// @notice Fixed price that never goes stale (the quote token).
    function setFixedPrice(address asset, uint256 price) external onlyOwner {
        if (asset == address(0) || price == 0) revert BadConfig();
        configs[asset] = Config({
            maxAgeSec: 0, fixedPrice: true, configured: true, bandMin: price, bandMax: price, feed: address(0)
        });
        _prices[asset] = Price(uint192(price), uint64(block.timestamp));
        emit AssetConfigured(asset, 0, price, price, true);
    }

    /// @notice Use a Chainlink feed for `asset` (address(0) to go back to pushed prices).
    function setFeed(address asset, address feed) external onlyOwner {
        Config storage c = configs[asset];
        if (!c.configured || c.fixedPrice) revert UnknownAsset(asset);
        c.feed = feed;
        emit FeedSet(asset, feed);
    }

    function setPusher(address pusher, bool allowed) external onlyOwner {
        isPusher[pusher] = allowed;
        emit PusherSet(pusher, allowed);
    }

    // ---------------------------------------------------------------- push

    function push(address asset, uint256 price) external {
        if (!isPusher[msg.sender]) revert NotPusher(msg.sender);
        _push(asset, price);
    }

    function pushMany(address[] calldata assets, uint256[] calldata prices) external {
        if (!isPusher[msg.sender]) revert NotPusher(msg.sender);
        if (assets.length != prices.length) revert LengthMismatch();
        for (uint256 i; i < assets.length; ++i) {
            _push(assets[i], prices[i]);
        }
    }

    function _push(address asset, uint256 price) internal {
        Config storage c = configs[asset];
        if (!c.configured) revert UnknownAsset(asset);
        if (c.fixedPrice) revert FixedPriceAsset(asset);
        if (c.feed != address(0)) revert FeedAsset(asset);
        if (price < c.bandMin || price > c.bandMax) revert PriceOutOfBand(asset, price, c.bandMin, c.bandMax);
        _prices[asset] = Price(uint192(price), uint64(block.timestamp));
        emit PricePushed(asset, price, block.timestamp);
    }

    // ---------------------------------------------------------------- reads

    function latest(address asset) public view returns (uint256 price, uint256 updatedAt) {
        Config storage c = configs[asset];
        if (!c.configured) revert UnknownAsset(asset);
        if (c.feed != address(0)) return _readFeed(c);
        Price memory p = _prices[asset];
        return (p.price, p.updatedAt);
    }

    function isFresh(address asset) public view returns (bool) {
        Config storage c = configs[asset];
        if (!c.configured) return false;
        if (c.fixedPrice) return true;
        (uint256 price, uint256 updatedAt) = latest(asset);
        return price != 0 && block.timestamp <= updatedAt + c.maxAgeSec;
    }

    function getPrice(address asset) external view returns (uint256) {
        Config storage c = configs[asset];
        (uint256 price, uint256 updatedAt) = latest(asset);
        if (c.fixedPrice) return price;
        if (price == 0 || block.timestamp > updatedAt + c.maxAgeSec) {
            revert PriceStale(asset, updatedAt, c.maxAgeSec);
        }
        return price;
    }

    function _readFeed(Config storage c) internal view returns (uint256, uint256) {
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(c.feed).latestRoundData();
        if (answer <= 0) return (0, updatedAt);
        uint8 d = IAggregatorV3(c.feed).decimals();
        uint256 price = d <= 18 ? uint256(answer) * 10 ** (18 - d) : uint256(answer) / 10 ** (d - 18);
        // An out-of-band feed answer is treated as no price (stale), never used.
        if (price < c.bandMin || price > c.bandMax) return (0, updatedAt);
        return (price, updatedAt);
    }
}
