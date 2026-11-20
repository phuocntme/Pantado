// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IndexVault} from "../../src/core/IndexVault.sol";
import {Fixture} from "../utils/Fixture.sol";

contract IndexFuzzTest is Fixture {
    function testFuzz_firstBuyLevelIs100(uint256 usdcIn, uint16 w0, uint16 w1) public {
        usdcIn = bound(usdcIn, 100e6, 1_000_000e6);
        w0 = uint16(bound(w0, 100, 9800));
        w1 = uint16(bound(w1, 100, 9900 - w0));
        address[] memory a = new address[](3);
        uint16[] memory w = new uint16[](3);
        (a[0], a[1], a[2]) = (address(six), address(btcb), address(wethe));
        (w[0], w[1], w[2]) = (w0, w1, 10_000 - w0 - w1);
        _fund(alice, usdcIn + CREATION_FEE);
        vm.prank(alice);
        (address idx,) = factory.createAndBuy(_params("FUZZ", a, w, usdcIn, true));
        assertApproxEqAbs(lens.level(idx), 100e18, 1e9);
    }

    function testFuzz_buyNeverDilutes(uint256 amount, uint256 btcPrice, uint256 avaxPrice) public {
        (IndexVault v,) = _create(alice, "TBB", 1000e6, true);
        _push(address(btcb), bound(btcPrice, 20_000e18, 300_000e18));
        _push(address(wavax), bound(avaxPrice, 2e18, 30e18));
        amount = bound(amount, 1e6, 500_000e6);
        uint256[] memory b0 = v.balances();
        uint256 s0 = v.totalSupply();
        uint256 l0 = lens.level(address(v));
        _buy(v, bob, amount);
        uint256[] memory b1 = v.balances();
        uint256 s1 = v.totalSupply();
        for (uint256 i; i < 3; ++i) {
            assertGe(b1[i] * s0, b0[i] * s1, "per-unit holdings never decrease");
        }
        assertGe(lens.level(address(v)) + 1e3, l0);
        assertEq(usdc.balanceOf(address(v)), 0, "no USDC left in vault");
    }

    function testFuzz_sellAndRedeemProRata(uint256 frac, bool viaRedeem) public {
        (IndexVault v, uint256 units) = _create(alice, "TBB", 10_000e6, true);
        uint256 s = bound(frac, 1, units);
        uint256[] memory b0 = v.balances();
        uint256 s0 = v.totalSupply();
        vm.prank(alice);
        if (viaRedeem) v.redeem(s, alice, new address[](0));
        else v.sell(s, 0, alice);
        uint256[] memory b1 = v.balances();
        for (uint256 i; i < 3; ++i) {
            assertEq(b0[i] - b1[i], b0[i] * s / s0);
            assertGe(b1[i] * s0, b0[i] * (s0 - s));
        }
    }
}
