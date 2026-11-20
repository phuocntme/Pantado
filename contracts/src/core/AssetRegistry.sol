// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title AssetRegistry
/// @notice On-chain mirror of config/assets.json for the execution network: which assets an index may hold,
///         their kind, decimals and venue, and the admin pause of new buys per asset (spec §5.2, §6).
contract AssetRegistry is Ownable {
    enum Kind {
        None,
        Token,
        Stock
    }

    struct AssetInfo {
        Kind kind;
        uint8 decimals;
        bool buysPaused;
        address venue;
    }

    address public immutable quote;
    mapping(address asset => AssetInfo) internal _info;
    address[] internal _assets;

    event AssetListed(address indexed asset, Kind kind, uint8 decimals, address venue);
    event VenueSet(address indexed asset, address venue);
    event BuysPaused(address indexed asset, bool paused);

    error AlreadyListed(address asset);
    error NotListed(address asset);
    error BadAsset();

    constructor(address owner_, address quote_) Ownable(owner_) {
        if (quote_ == address(0)) revert BadAsset();
        quote = quote_;
    }

    function list(address asset, Kind kind, address venue) external onlyOwner {
        if (asset == address(0) || asset == quote || kind == Kind.None || venue == address(0)) revert BadAsset();
        if (_info[asset].kind != Kind.None) revert AlreadyListed(asset);
        uint8 dec = IERC20Metadata(asset).decimals();
        _info[asset] = AssetInfo({kind: kind, decimals: dec, buysPaused: false, venue: venue});
        _assets.push(asset);
        emit AssetListed(asset, kind, dec, venue);
    }

    function setVenue(address asset, address venue) external onlyOwner {
        if (_info[asset].kind == Kind.None) revert NotListed(asset);
        if (venue == address(0)) revert BadAsset();
        _info[asset].venue = venue;
        emit VenueSet(asset, venue);
    }

    /// @notice Pause new buys of one asset. Sells continue; redeem is never affected.
    function setBuysPaused(address asset, bool paused) external onlyOwner {
        if (_info[asset].kind == Kind.None) revert NotListed(asset);
        _info[asset].buysPaused = paused;
        emit BuysPaused(asset, paused);
    }

    function info(address asset) external view returns (AssetInfo memory) {
        return _info[asset];
    }

    function isListed(address asset) external view returns (bool) {
        return _info[asset].kind != Kind.None;
    }

    function venueOf(address asset) external view returns (address v) {
        v = _info[asset].venue;
        if (v == address(0)) revert NotListed(asset);
    }

    function buysPaused(address asset) external view returns (bool) {
        return _info[asset].buysPaused;
    }

    function assets() external view returns (address[] memory) {
        return _assets;
    }
}
