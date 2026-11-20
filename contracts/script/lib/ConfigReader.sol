// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

/// @notice One asset from the generated `config/assets.<network>.json` (gen-config). `addr` is
///         "deploy" (deployed by us), "TODO" (unconfirmed — never use) or a confirmed address.
struct ContractAsset {
    string addr;
    uint256 bandMaxE18;
    uint256 bandMinE18;
    uint256 decimals;
    string id;
    string kind;
    uint256 maxAgeSec;
    bool mock;
    string name;
    uint256 oiCapUsd;
    string pTokenName;
    string pTokenSymbol;
    uint256 priceE18;
    uint256 sizeCapUsd;
    uint256 spreadBps;
    string symbol;
    uint256 tier;
    string venue;
}

/// @notice Reads contracts/config/*.json from Solidity tests and scripts.
library ConfigReader {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    string internal constant ASSET_TYPE = "ContractAsset(string addr,uint256 bandMaxE18,uint256 bandMinE18,"
        "uint256 decimals,string id,string kind,uint256 maxAgeSec,bool mock,string name,uint256 oiCapUsd,"
        "string pTokenName,string pTokenSymbol,uint256 priceE18,uint256 sizeCapUsd,uint256 spreadBps,"
        "string symbol,uint256 tier,string venue)";

    function read(string memory rel) internal view returns (string memory) {
        return VM.readFile(string.concat(VM.projectRoot(), "/", rel));
    }

    function assets(string memory network) internal view returns (ContractAsset[] memory) {
        string memory json = read(string.concat("config/assets.", network, ".json"));
        return abi.decode(VM.parseJsonTypeArray(json, ".assets", ASSET_TYPE), (ContractAsset[]));
    }

    function params() internal view returns (string memory) {
        return read("config/params.json");
    }

    function eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
