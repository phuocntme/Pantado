// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetRegistry} from "../../src/core/AssetRegistry.sol";
import {SwapRouter} from "../../src/router/SwapRouter.sol";
import {StockVenue} from "../../src/venues/StockVenue.sol";
import {Fixture} from "../utils/Fixture.sol";

contract SwapRouterTest is Fixture {
    SwapRouter router;
    StockVenue stocks;
    address nvda;

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        stocks = new StockVenue(admin, address(oracle), address(usdc), 15_000);
        nvda = stocks.listStock("Pantado NVIDIA", "pNVDA", 25_000, 250_000, 15);
        oracle.configureAsset(nvda, 3600, 32e18, 823e18);
        registry.list(nvda, AssetRegistry.Kind.Stock, address(stocks));
        usdc.mint(admin, 5_000_000e6);
        usdc.approve(address(stocks), type(uint256).max);
        stocks.fund(5_000_000e6);
        router = new SwapRouter(admin, address(registry), treasury, 10);
        usdc.mint(alice, 100_000e6);
        vm.stopPrank();
        _push(nvda, 164.6e18);
        vm.prank(alice);
        usdc.approve(address(router), type(uint256).max);
    }

    function test_usdcToStock_feeToTreasury() public {
        (uint256 q, uint256 fee) = router.quote(address(usdc), nvda, 1000e6);
        assertEq(fee, 1e6);
        uint256 t0 = usdc.balanceOf(treasury);
        vm.prank(alice);
        uint256 out = router.swap(address(usdc), nvda, 1000e6, q, alice);
        assertEq(out, q);
        assertEq(usdc.balanceOf(treasury) - t0, 1e6);
    }

    function test_stockToToken_viaUsdc() public {
        vm.prank(alice);
        uint256 got = router.swap(address(usdc), nvda, 1000e6, 0, alice);
        vm.startPrank(alice);
        (bool ok,) = nvda.call(abi.encodeWithSignature("approve(address,uint256)", address(router), got));
        assertTrue(ok);
        (uint256 q,) = router.quote(nvda, address(btcb), got);
        uint256 out = router.swap(nvda, address(btcb), got, q, alice);
        vm.stopPrank();
        assertEq(out, q);
        assertEq(btcb.balanceOf(alice), out);
        // ≈ 1000 × (1 − 0.1 %)² × (1 − 0.15 %)² × (1 − 0.3 %) / 74 357 BTC
        assertApproxEqRel(out, uint256(1000e8) * 9937 / 10_000 / 74_357, 2e15);
    }

    function test_onlyRegistryAssets() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SwapRouter.NotListed.selector, address(0xBEEF)));
        router.swap(address(usdc), address(0xBEEF), 1e6, 0, alice);
        vm.expectRevert(SwapRouter.SameToken.selector);
        router.quote(address(btcb), address(btcb), 1);
    }

    function test_slippage() public {
        (uint256 q,) = router.quote(address(usdc), address(wavax), 1000e6);
        vm.prank(alice);
        vm.expectRevert();
        router.swap(address(usdc), address(wavax), 1000e6, q + 1, alice);
    }
}
