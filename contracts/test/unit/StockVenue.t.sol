// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {PToken} from "../../src/venues/PToken.sol";
import {StockVenue} from "../../src/venues/StockVenue.sol";
import {TestUSDC} from "../../src/test-tokens/TestUSDC.sol";

contract StockVenueTest is Test {
    address admin = makeAddr("admin");
    address pusher = makeAddr("pusher");
    address user = makeAddr("user");
    TestUSDC usdc;
    PriceOracle oracle;
    StockVenue venue;
    address nvda; // tier 1
    address mu; // tier 2

    function setUp() public {
        vm.warp(1_750_000_000);
        vm.startPrank(admin);
        usdc = new TestUSDC(admin);
        oracle = new PriceOracle(admin);
        oracle.setPusher(pusher, true);
        venue = new StockVenue(admin, address(oracle), address(usdc), 15_000);
        nvda = venue.listStock("Pantado NVIDIA", "pNVDA", 25_000, 250_000, 15);
        mu = venue.listStock("Pantado Micron", "pMU", 5000, 50_000, 15);
        oracle.configureAsset(nvda, 3600, 32e18, 823e18);
        oracle.configureAsset(mu, 3600, 20e18, 500e18);
        usdc.mint(admin, 5_000_000e6);
        usdc.approve(address(venue), type(uint256).max);
        venue.fund(5_000_000e6);
        usdc.mint(user, 10_000_000e6);
        vm.stopPrank();
        vm.startPrank(pusher);
        oracle.push(nvda, 164.6e18);
        oracle.push(mu, 100e18);
        vm.stopPrank();
        vm.prank(user);
        usdc.approve(address(venue), type(uint256).max);
    }

    function _buy(address p, uint256 usdcIn) internal returns (uint256) {
        vm.prank(user);
        return venue.swapExactIn(address(usdc), p, usdcIn, 0, user);
    }

    function test_names() public view {
        assertEq(PToken(nvda).name(), "Pantado NVIDIA");
        assertEq(PToken(nvda).symbol(), "pNVDA");
        assertEq(PToken(nvda).decimals(), 18);
    }

    function test_buyAtMidPlusSpread_quoteEqualsSwap() public {
        uint256 q = venue.quote(address(usdc), nvda, 10_000e6);
        uint256 out = _buy(nvda, 10_000e6);
        assertEq(out, q);
        uint256 exec = uint256(164.6e18) * 10_015 / 10_000;
        assertEq(out, uint256(10_000e18) * 1e18 / exec);
        assertEq(venue.outstanding(nvda), out);
        assertEq(venue.reserve(), 5_010_000e6);
    }

    function test_sellAtMidMinusSpread_burns() public {
        uint256 got = _buy(nvda, 10_000e6);
        uint256 q = venue.quote(nvda, address(usdc), got);
        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        uint256 out = venue.swapExactIn(nvda, address(usdc), got, 0, user);
        assertEq(out, q);
        assertEq(usdc.balanceOf(user) - before, out);
        assertEq(venue.outstanding(nvda), 0);
        // round trip costs the spread twice (~0.3 %), which stays in the reserve
        assertApproxEqRel(out, 10_000e6 * 9970 / 10_000, 1e15);
        assertGt(venue.pnlUsd(), 0);
    }

    function test_sizeCapPerTier() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(StockVenue.SizeCapExceeded.selector, 25_001e18, 25_000e18));
        venue.swapExactIn(address(usdc), nvda, 25_001e6, 0, user);
        _buy(nvda, 25_000e6);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(StockVenue.SizeCapExceeded.selector, 5001e18, 5000e18));
        venue.swapExactIn(address(usdc), mu, 5001e6, 0, user);
    }

    function test_oiCap() public {
        // spread lowers notional at mid: 10 × 5 000 USDC ≈ 49 925 USD < 50 000 cap
        for (uint256 i; i < 10; ++i) {
            _buy(mu, 5000e6);
        }
        vm.prank(user);
        vm.expectPartialRevert(StockVenue.OiCapExceeded.selector);
        venue.swapExactIn(address(usdc), mu, 5000e6, 0, user);
    }

    function test_reserveGuard() public {
        vm.prank(admin);
        venue.withdraw(4_900_000e6, admin); // leave 100k reserve
        // 100k + x ≥ 1.5 · x / (1 + spread)  ⇒  x ≤ ~200.9k: 8 buys of 25k pass, the 9th fails
        uint256 bought;
        for (uint256 i; i < 8; ++i) {
            _buy(nvda, 25_000e6);
            bought += 25_000e6;
        }
        vm.prank(user);
        vm.expectPartialRevert(StockVenue.ReserveGuard.selector);
        venue.swapExactIn(address(usdc), nvda, 25_000e6, 0, user);
        assertLe(venue.totalExposureUsd() * 15_000 / 10_000, venue.reserve() * 1e12);
    }

    function test_withdrawKeepsGuard() public {
        _buy(nvda, 25_000e6);
        vm.prank(admin);
        vm.expectPartialRevert(StockVenue.InsufficientReserve.selector);
        venue.withdraw(5_000_000e6, admin);
    }

    function test_pauseBuysOnly() public {
        uint256 got = _buy(nvda, 1000e6);
        vm.prank(admin);
        venue.setBuysPaused(nvda, true);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(StockVenue.BuysPausedFor.selector, nvda));
        venue.swapExactIn(address(usdc), nvda, 1000e6, 0, user);
        vm.prank(user);
        venue.swapExactIn(nvda, address(usdc), got, 0, user); // sells stay open
    }

    function test_staleReverts() public {
        vm.warp(block.timestamp + 3601);
        vm.prank(user);
        vm.expectPartialRevert(PriceOracle.PriceStale.selector);
        venue.swapExactIn(address(usdc), nvda, 1000e6, 0, user);
        assertGt(venue.exposureUsd(nvda) + 1, 0, "views never revert");
    }

    function test_onlyVenueMintsBurns() public {
        vm.expectRevert(PToken.OnlyVenue.selector);
        PToken(nvda).mint(user, 1);
        vm.expectRevert(PToken.OnlyVenue.selector);
        PToken(nvda).burn(user, 1);
    }

    function test_open247() public {
        // Saturday 03:00 UTC and Sunday: no sessions
        vm.warp(1_750_464_000);
        vm.prank(pusher);
        oracle.push(nvda, 164.6e18);
        _buy(nvda, 1000e6);
    }
}

contract StockHandler is Test {
    StockVenue public venue;
    TestUSDC public usdc;
    address[] public stocks;
    address public user = address(0xB0B);

    constructor(StockVenue v, TestUSDC u, address[] memory s) {
        venue = v;
        usdc = u;
        stocks = s;
        vm.prank(user);
        usdc.approve(address(venue), type(uint256).max);
    }

    function buy(uint256 seed, uint256 amount) external {
        address s = stocks[seed % stocks.length];
        amount = bound(amount, 1e6, 25_000e6);
        vm.prank(usdc.owner());
        usdc.mint(user, amount);
        vm.prank(user);
        try venue.swapExactIn(address(usdc), s, amount, 0, user) {} catch {}
    }

    function sell(uint256 seed, uint256 frac) external {
        address s = stocks[seed % stocks.length];
        uint256 bal = PToken(s).balanceOf(user);
        if (bal == 0) return;
        vm.prank(user);
        try venue.swapExactIn(s, address(usdc), bound(frac, 1, bal), 0, user) {} catch {}
    }
}

/// @notice reserve ≥ 0 and Σ outstanding × mid ≤ reserve × 10000 / reserveRatioBps after any trade sequence.
contract StockVenueInvariantTest is Test {
    StockVenue venue;
    TestUSDC usdc;
    StockHandler h;

    function setUp() public {
        address admin = makeAddr("admin");
        vm.warp(1_750_000_000);
        vm.startPrank(admin);
        usdc = new TestUSDC(admin);
        PriceOracle oracle = new PriceOracle(admin);
        oracle.setPusher(admin, true);
        venue = new StockVenue(admin, address(oracle), address(usdc), 15_000);
        address[] memory s = new address[](3);
        s[0] = venue.listStock("A", "pA", 25_000, 250_000, 15);
        s[1] = venue.listStock("B", "pB", 25_000, 250_000, 15);
        s[2] = venue.listStock("C", "pC", 5000, 50_000, 15);
        for (uint256 i; i < 3; ++i) {
            oracle.configureAsset(s[i], 365 days, 1e18, 1e21);
            oracle.push(s[i], (50 + 70 * i) * 1e18);
        }
        usdc.mint(admin, 200_000e6);
        usdc.approve(address(venue), type(uint256).max);
        venue.fund(200_000e6);
        vm.stopPrank();
        h = new StockHandler(venue, usdc, s);
        targetContract(address(h));
    }

    function invariant_reserveCoversBook() public view {
        assertLe(venue.totalExposureUsd(), venue.reserve() * 1e12 * 10_000 / venue.reserveRatioBps());
    }
}
