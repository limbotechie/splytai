// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/console.sol";
import "forge-std/Script.sol";
import "../src/SplytSession.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address token = vm.envOr("USDM_TOKEN", address(0x765DE816845861e75A25fCA122bb6898B8B1282a));

        vm.startBroadcast(deployerPrivateKey);
        SplytSession deployed = new SplytSession(token);
        vm.stopBroadcast();

        console.log("SplytSession deployed at:", address(deployed));
        console.log("Payment token:", token);
    }
}
