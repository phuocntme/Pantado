// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {FeeSplitter} from "../../src/fees/FeeSplitter.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {TestUSDC} from "../../src/test-tokens/TestUSDC.sol";
import {Fixture} from "../utils/Fixture.sol";

contract Handler is Test {
    IndexVault public vault;
    TestUSDC public usdc;
    PriceOracle public oracle;
    address public admin;
    address public pusher;
    address[] public assets;
    address[] public actors;

    bool public diluted;
    bool public redeemFailed;
    uint256 public redeems;
    uint256 public staleRedeems;

    constructor(IndexVault v, TestUSDC u, PriceOracle o, address admin_, address pusher_, address[] memory actors_) {
        vault = v;
        usdc = u;
        oracle = o;
        admin = admin_;
        pusher = pusher_;
        assets = v.assets();
        actors = actors_;
    }

    function _snap() internal view returns (uint256[] memory b, uint256 s) {
        b = vault.balances();
        s = vault.totalSupply();
    }

    function _check(uint256[] memory b0, uint256 s0) internal {
        (uint256[] memory b1, uint256 s1) = _snap();
        for (uint256 i; i < b0.length; ++i) {
            if (b1[i] * s0 < b0[i] * s1) diluted = true;
        }
    }

    function buy(uint256 actorSeed, uint256 amount) external {
        address who = actors[actorSeed % actors.length];
        amount = bound(amount, 1e6, 200_000e6);
        (uint256[] memory b0, uint256 s0) = _snap();
        vm.prank(admin);
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), amount);
        try vault.buy(amount, 0, who) {} catch {}
        vm.stopPrank();
        _check(b0, s0);
    }

    function sell(uint256 actorSeed, uint256 frac) external {
        address who = actors[actorSeed % actors.length];
        uint256 bal = vault.balanceOf(who);
        if (bal == 0) return;
        uint256 s = bound(frac, 1, bal);
        (uint256[] memory b0, uint256 s0) = _snap();
        vm.prank(who);
        try vault.sell(s, 0, who) {} catch {}
        _check(b0, s0);
    }

    function redeem(uint256 actorSeed, uint256 frac, bool forfeitFirst) external {
        address who = actors[actorSeed % actors.length];
        uint256 bal = vault.balanceOf(who);
        if (bal == 0) return;
        uint256 s = bound(frac, 1, bal);
        address[] memory f = new address[](forfeitFirst ? 1 : 0);
        if (forfeitFirst) f[0] = assets[0];
        (uint256[] memory b0, uint256 s0) = _snap();
        bool stale = !oracle.isFresh(assets[0]);
        vm.prank(who);
        try vault.redeem(s, who, f) {
            redeems++;
            if (stale) staleRedeems++;
        } catch {
            redeemFailed = true;
        }
        _check(b0, s0);
    }

    function movePrice(uint256 assetSeed, uint256 bps) external {
        address a = assets[assetSeed % assets.length];
        (uint256 p,) = oracle.latest(a);
        (,,, uint256 bandMin, uint256 bandMax,) = oracle.configs(a);
        bps = bound(bps, 8000, 12_500);
        uint256 np = p * bps / 10_000;
        if (np < bandMin) np = bandMin;
        if (np > bandMax) np = bandMax;
        vm.prank(pusher);
        oracle.push(a, np);
    }

    function warp(uint256 secs) external {
        vm.warp(vm.getBlockTimestamp() + bound(secs, 1, 2 hours));
    }

    function refresh() external {
        for (uint256 i; i < assets.length; ++i) {
            (uint256 p,) = oracle.latest(assets[i]);
            vm.prank(pusher);
            oracle.push(assets[i], p);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

contract IndexInvariantTest is Fixture {
    Handler internal handler;
    IndexVault internal vault;

    function setUp() public override {
        super.setUp();
        (vault,) = _create(alice, "INV", 10_000e6, true);
        address[] memory actors = new address[](3);
        (actors[0], actors[1], actors[2]) = (alice, bob, makeAddr("carol"));
        handler = new Handler(vault, usdc, oracle, admin, pusher, actors);
        targetContract(address(handler));
    }

    function invariant_neverEmpty() public view {
        assertGe(vault.totalSupply(), 0.01e18);
        assertEq(vault.balanceOf(vault.DEAD()), 0.01e18);
    }

    function invariant_supplyMatchesHolders() public view {
        uint256 sum = vault.balanceOf(vault.DEAD());
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += vault.balanceOf(handler.actors(i));
        }
        assertEq(sum, vault.totalSupply());
    }

    function invariant_noDilution() public view {
        assertFalse(handler.diluted(), "per-unit holdings decreased");
    }

    function invariant_redeemAlwaysWorks() public view {
        assertFalse(handler.redeemFailed(), "redeem reverted");
    }

    function invariant_vaultHoldsNoUsdc() public view {
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function invariant_splitterSolvent() public view {
        assertGe(usdc.balanceOf(address(splitter)), splitter.totalOwed());
    }

    /// @dev Stronger than counting redeems: in every reachable end state (stale prices included),
    ///      every holder can redeem their full balance, and the vault keeps only the dead units.
    function afterInvariant() public {
        for (uint256 i; i < handler.actorCount(); ++i) {
            address who = handler.actors(i);
            uint256 bal = vault.balanceOf(who);
            if (bal == 0) continue;
            vm.prank(who);
            vault.redeem(bal, who, new address[](0));
        }
        assertEq(vault.totalSupply(), 0.01e18);
    }
}
