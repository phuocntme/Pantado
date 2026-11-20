// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ConfigReader, ContractAsset} from "../../script/lib/ConfigReader.sol";

/// @notice The generated assets file and params.json must be readable from Solidity (deploy scripts, P4).
contract ConfigTest is Test {
    using stdJson for string;

    function _read(string memory rel) internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/", rel));
    }

    function test_paramsReadable() public view {
        string memory j = _read("config/params.json");
        assertEq(j.readUint(".vault.tradeFeeBps"), 50);
        assertEq(j.readUint(".fees.protocolBps") + j.readUint(".fees.creatorBps"), 50);
        assertEq(j.readUint(".vault.deadUnitsWei"), 0.01e18);
        assertEq(j.readUint(".vault.startLevelUsd"), 100);
        assertEq(j.readUint(".factory.creationFeeUsdc"), 5);
        assertEq(j.readUint(".factory.minFirstBuyUsdc"), 100);
        assertEq(j.readUint(".rebalancer.noticeSec"), 48 hours);
        assertEq(j.readUint(".rebalancer.maxDurationSec"), 14 days);
        assertEq(j.readUint(".rebalancer.auctionSec"), 45 minutes);
        assertEq(j.readUint(".stockVenue.reserveRatioBps"), 15_000);
        assertEq(j.readUint(".swapRouter.swapFeeBps"), 10);
        assertEq(j.readString(".treasury"), "deployer");
    }

    function test_fujiAssetsDecode() public view {
        string memory j = _read("config/assets.fuji.json");
        assertEq(j.readUint(".chainId"), 43113);
        ContractAsset[] memory assets = ConfigReader.assets("fuji");
        assertEq(assets.length, 61); // USDC + 35 tokens + 25 stocks
        assertEq(assets[0].id, "usdc");
        assertEq(assets[0].decimals, 6);
        assertEq(assets[0].priceE18, 1e18);
        uint256 stocks;
        for (uint256 i; i < assets.length; ++i) {
            if (ConfigReader.eq(assets[i].kind, "stock")) {
                ++stocks;
                assertEq(bytes(assets[i].pTokenSymbol)[0], bytes1("p"));
                assertEq(assets[i].spreadBps, 15);
                assertGt(assets[i].priceE18, 0);
                assertLe(assets[i].bandMinE18, assets[i].priceE18);
                assertGe(assets[i].bandMaxE18, assets[i].priceE18);
                assertEq(assets[i].addr, "deploy");
            }
        }
        assertEq(stocks, 25);
    }

    function test_avalancheAssetsNeverDeployMocks() public view {
        ContractAsset[] memory assets = ConfigReader.assets("avalanche");
        for (uint256 i; i < assets.length; ++i) {
            assertFalse(assets[i].mock);
        }
    }
}
