// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AssetRegistry} from "../../src/core/AssetRegistry.sol";
import {IndexFactory} from "../../src/core/IndexFactory.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {StockVenue} from "../../src/venues/StockVenue.sol";
import {SwapRouter} from "../../src/router/SwapRouter.sol";
import {Fixture} from "../utils/Fixture.sol";

/// @notice Writes test/fixtures/golden.json: index states + IndexLens / SwapRouter outputs. The TypeScript
///         port in packages/shared/src/math must reproduce every number exactly.
contract GoldenFixturesTest is Fixture {
    StockVenue internal sv;
    SwapRouter internal router;
    address internal nvda;
    address internal mu;
    string internal json;

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        sv = new StockVenue(admin, address(oracle), address(usdc), 15_000);
        nvda = sv.listStock("Pantado NVIDIA", "pNVDA", 25_000, 250_000, 15);
        mu = sv.listStock("Pantado Micron", "pMU", 5000, 50_000, 15);
        oracle.configureAsset(nvda, 3600, 32e18, 823e18);
        oracle.configureAsset(mu, 3600, 20e18, 500e18);
        registry.list(nvda, AssetRegistry.Kind.Stock, address(sv));
        registry.list(mu, AssetRegistry.Kind.Stock, address(sv));
        usdc.mint(admin, 300_000e6);
        usdc.approve(address(sv), type(uint256).max);
        sv.fund(300_000e6);
        router = new SwapRouter(admin, address(registry), treasury, 10);
        vm.stopPrank();
        _push(nvda, 164.6e18);
        _push(mu, 97.31e18);
    }

    function test_writeGolden() public {
        address[] memory a = new address[](4);
        uint16[] memory w = new uint16[](4);
        (a[0], a[1], a[2], a[3]) = (nvda, mu, address(btcb), address(wavax));
        (w[0], w[1], w[2], w[3]) = (3000, 2000, 3500, 1500);
        _fund(alice, 20_000e6 + CREATION_FEE);
        vm.prank(alice);
        (address idx,) = factory.createAndBuy(_params("GOLD", a, w, 20_000e6, true));
        IndexVault v = IndexVault(idx);

        string memory s1 = _scenario("afterCreate", v);
        _push(nvda, 211.37e18);
        _push(address(btcb), 61_234.5e18);
        _buy(v, bob, 3333.333333e6);
        string memory s2 = _scenario("afterMoves", v);
        _push(mu, 140e18);
        string memory s3 = _scenario("muRally", v);
        string memory sw = _swaps();
        address[5] memory ms = [nvda, mu, address(btcb), address(wavax), address(wethe)];
        string memory markets = "[";
        for (uint256 i; i < 5; ++i) {
            if (i > 0) markets = string.concat(markets, ",");
            markets = string.concat(markets, _leg(ms[i], registry.info(ms[i]).decimals, 0, 0));
        }
        markets = string.concat(markets, "]");

        json = string.concat(
            '{"usdc":"', vm.toString(address(usdc)), '","tokenVenueUsdc":', _u(usdc.balanceOf(address(venue))),
            ',"swapFeeBps":10,"scenarios":[', s1, ",", s2, ",", s3, '],"markets":', markets, ',"swaps":', sw, "}"
        );
        vm.writeFile(string.concat(vm.projectRoot(), "/test/fixtures/golden.json"), json);
    }

    function _u(uint256 x) internal pure returns (string memory) {
        return string.concat('"', vm.toString(x), '"');
    }

    function _scenario(string memory name, IndexVault v) internal view returns (string memory) {
        string memory legs = "[";
        address[] memory as_ = v.assets();
        uint256[] memory bal = v.balances();
        uint16[] memory w = v.targetWeights();
        uint8[] memory d = v.assetDecimals();
        for (uint256 i; i < as_.length; ++i) {
            if (i > 0) legs = string.concat(legs, ",");
            legs = string.concat(legs, _leg(as_[i], d[i], bal[i], w[i]));
        }
        legs = string.concat(legs, "]");
        string memory buys = "[";
        uint256[5] memory amts = [uint256(1e6), 100e6, 777.777777e6, 5000e6, 24_000e6];
        for (uint256 i; i < amts.length; ++i) {
            if (i > 0) buys = string.concat(buys, ",");
            try lens.previewBuy(address(v), amts[i]) returns (uint256 units, uint256 fee) {
                buys = string.concat(buys, '{"usdcIn":', _u(amts[i]), ',"units":', _u(units), ',"fee":', _u(fee), "}");
            } catch (bytes memory err) {
                buys = string.concat(buys, '{"usdcIn":', _u(amts[i]), ',"error":"', _errName(err), '"}');
            }
        }
        buys = string.concat(buys, "]");
        string memory sells = "[";
        uint256 s = v.totalSupply();
        uint256[4] memory fr = [uint256(1e12), s / 7, s / 2, s - 0.01e18];
        for (uint256 i; i < fr.length; ++i) {
            if (i > 0) sells = string.concat(sells, ",");
            try lens.previewSell(address(v), fr[i]) returns (uint256 out, uint256 fee) {
                sells = string.concat(sells, '{"units":', _u(fr[i]), ',"usdcOut":', _u(out), ',"fee":', _u(fee), "}");
            } catch (bytes memory err) {
                sells = string.concat(sells, '{"units":', _u(fr[i]), ',"error":"', _errName(err), '"}');
            }
        }
        sells = string.concat(sells, "]");
        return string.concat(
            '{"name":"', name, '","supply":', _u(s), ',"tradeFeeBps":50,"deadUnits":', _u(0.01e18),
            ',"startLevelUsd":"100","usdcDecimals":6,"tokenVenue":"', vm.toString(address(venue)),
            '","tokenVenueUsdc":', _u(usdc.balanceOf(address(venue))), ',"level":', _u(lens.level(address(v))),
            ',"maxDriftBps":', _u(lens.maxDriftBps(address(v))), ',"legs":', legs, ',"buys":', buys, ',"sells":', sells, "}"
        );
    }

    function _errName(bytes memory err) internal pure returns (string memory) {
        bytes4 s = bytes4(err);
        if (s == StockVenue.SizeCapExceeded.selector) return "SizeCapExceeded";
        if (s == StockVenue.OiCapExceeded.selector) return "OiCapExceeded";
        if (s == StockVenue.ReserveGuard.selector) return "ReserveGuard";
        if (s == StockVenue.InsufficientReserve.selector) return "InsufficientReserve";
        if (s == StockVenue.BuysPausedFor.selector) return "BuysPausedFor";
        return "Unknown";
    }

    function _leg(address a, uint8 dec, uint256 bal, uint16 w) internal view returns (string memory) {
        (uint256 p,) = oracle.latest(a);
        AssetRegistry.AssetInfo memory info = registry.info(a);
        string memory head = string.concat(
            '{"asset":"', vm.toString(a), '","decimals":', vm.toString(dec), ',"balance":', _u(bal),
            ',"targetBps":', vm.toString(w), ',"priceWad":', _u(p), ',"venue":"', vm.toString(info.venue), '"'
        );
        if (info.kind == AssetRegistry.Kind.Stock) {
            (, bool paused, uint16 spread, uint256 sizeCap, uint256 oiCap) = sv.markets(a);
            return string.concat(
                head, ',"kind":"stock","spreadBps":', vm.toString(spread), ',"buysPaused":', paused ? "true" : "false",
                ',"sizeCapUsdWad":', _u(sizeCap), ',"oiCapUsdWad":', _u(oiCap), ',"outstanding":', _u(IERC20(a).totalSupply()),
                ',"totalExposureUsdWad":', _u(sv.totalExposureUsd()), ',"reserve":', _u(sv.reserve()),
                ',"reserveRatioBps":', vm.toString(sv.reserveRatioBps()), "}"
            );
        }
        (,, uint16 tspread) = venue.markets(a);
        return string.concat(
            head, ',"kind":"token","spreadBps":', vm.toString(tspread), ',"inventoryOut":', _u(IERC20(a).balanceOf(address(venue))), "}"
        );
    }

    function _swaps() internal view returns (string memory out) {
        address[3] memory ins = [address(usdc), nvda, address(btcb)];
        address[3] memory outs = [address(wethe), address(btcb), mu];
        uint256[3] memory amts = [uint256(1234.56e6), 3.3e18, 0.05e8];
        out = "[";
        for (uint256 i; i < 3; ++i) {
            (uint256 q, uint256 fee) = router.quote(ins[i], outs[i], amts[i]);
            if (i > 0) out = string.concat(out, ",");
            out = string.concat(
                out, '{"tokenIn":"', vm.toString(ins[i]), '","tokenOut":"', vm.toString(outs[i]), '","amountIn":', _u(amts[i]),
                ',"amountOut":', _u(q), ',"fee":', _u(fee), "}"
            );
        }
        out = string.concat(out, "]");
    }
}
