// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IndexLens} from "../../src/core/IndexLens.sol";
import {IndexVault} from "../../src/core/IndexVault.sol";
import {Rebalancer} from "../../src/rebalance/Rebalancer.sol";
import {RebalanceFixture} from "../utils/RebalanceFixture.sol";

/// @notice Spec §14.7 / P3 gate: +40 % shock on one asset of an Auto index with θ = 20 % → plan → filler
///         fills → max drift back under 10 %, all guards respected.
contract ShockScenarioTest is RebalanceFixture {
    function test_shock_plan_fill_driftReduced() public {
        IndexVault v = _createMode(alice, "CHIP", 2, 2000, 50_000e6);
        assertLt(lens.maxDriftBps(address(v)), 10);

        // scripted shock: JOE +40 %
        _push(address(joe), 0.28e18);
        uint256 driftAfterShock = lens.maxDriftBps(address(v));
        assertGe(driftAfterShock, 2000, "drift >= theta");

        rebalancer.trigger(address(v));
        _warp(172_800); // public notice
        _refresh5();
        rebalancer.startPlan(address(v));
        Rebalancer.Plan memory p = rebalancer.plan(address(v));
        uint256 cap = p.valueAtStart * 500 / 10_000;

        // keeper loop: open → filler fills when the price reaches the reference → repeat
        uint256 rounds;
        while (rounds < 200) {
            ++rounds;
            Rebalancer.Plan memory cur = rebalancer.plan(address(v));
            if (cur.status != Rebalancer.Status.Active) break;
            try rebalancer.openAuction(address(v)) {}
            catch {
                _warp(1 hours); // daily cap: wait
                _refresh5();
                continue;
            }
            if (rebalancer.plan(address(v)).status != Rebalancer.Status.Active) break;
            _fillAll(v, 540); // 9 min: price ≈ ref
            assertLe(rebalancer.tradedLast24h(address(v)), cap, "daily cap");
            _warp(60);
            _refresh5();
        }
        p = rebalancer.plan(address(v));
        assertEq(uint8(p.status), uint8(Rebalancer.Status.Completed), "plan completed");
        assertLe(p.loss, int256(p.lossBudget), "loss budget");
        assertLe(p.endedAt - p.startedAt, 14 days, "max duration");

        uint256 driftAfter = lens.maxDriftBps(address(v));
        emit log_named_uint("max drift after shock (bps)", driftAfterShock);
        emit log_named_uint("max drift after plan  (bps)", driftAfter);
        emit log_named_uint("auctions", p.auctionCount);
        assertLt(driftAfter, 1000, "max drift < 10 %");
    }
}
