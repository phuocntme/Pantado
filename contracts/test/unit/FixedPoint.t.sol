// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FixedPoint} from "../../src/libraries/FixedPoint.sol";

contract FixedPointTest is Test {
    function test_valueOf() public pure {
        // 1.5 BTC.b (8 dp) at 74,357 USD
        assertEq(FixedPoint.valueOf(1.5e8, 74_357e18, 8), 111_535.5e18);
        // 100 USDC (6 dp) at 1 USD
        assertEq(FixedPoint.valueOf(100e6, 1e18, 6), 100e18);
    }

    function test_bps() public pure {
        assertEq(FixedPoint.mulBps(1000e6, 50), 5e6);
        assertEq(FixedPoint.mulBpsUp(1, 50), 1);
        assertEq(FixedPoint.mulBps(1, 50), 0);
    }

    function testFuzz_amountForRoundTripNeverOverpays(uint128 usd, uint96 price, uint8 dec) public pure {
        vm.assume(price > 0);
        dec = uint8(bound(dec, 0, 18));
        uint256 amt = FixedPoint.amountFor(usd, price, dec);
        assertLe(FixedPoint.valueOf(amt, price, dec), usd);
    }
}
