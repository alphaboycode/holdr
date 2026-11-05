// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Holdr} from "../src/Holdr.sol";

contract DeployScript is Script {
    function run() external returns (Holdr holdr) {
        vm.startBroadcast();
        holdr = new Holdr();
        vm.stopBroadcast();

        console.log("Holdr deployed to:", address(holdr));
    }
}
