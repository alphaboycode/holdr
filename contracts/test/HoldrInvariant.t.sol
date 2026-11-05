// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Holdr} from "../src/Holdr.sol";

contract HoldrHandler is Test {
    Holdr public holdr;

    address[] public users;
    uint256[] public dealIds;

    uint256 public totalPendingDeposited;
    uint256 public totalWithdrawn;

    constructor(Holdr _holdr, address[] memory _users) {
        holdr = _holdr;
        users = _users;
    }

    function createDeal(
        uint256 buyerSeed,
        uint256 sellerSeed,
        uint256 arbiterSeed,
        uint256 amountSeed,
        uint32 deliveryDaysSeed,
        uint32 reviewDaysSeed
    ) public {
        uint256 uLen = users.length;
        address buyer = users[buyerSeed % uLen];
        address seller = users[sellerSeed % uLen];
        address arbiter = users[arbiterSeed % uLen];

        if (buyer == seller || buyer == arbiter || seller == arbiter) return;

        uint256 amount = bound(amountSeed, 1 ether, 10 ether);
        uint32 deliveryDays = uint32(bound(deliveryDaysSeed, 1, 90));
        uint32 reviewDays = uint32(bound(reviewDaysSeed, 1, 14));

        vm.deal(buyer, amount);
        vm.prank(buyer);
        uint256 id = holdr.createDeal{value: amount}(
            seller,
            arbiter,
            "Service Deal",
            "Freelance Scope",
            deliveryDays,
            reviewDays
        );

        dealIds.push(id);
    }

    function markDelivered(uint256 dealIdxSeed) public {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[dealIdxSeed % dealIds.length];
        Holdr.Deal memory d = holdr.getDeal(id);
        if (d.status != Holdr.Status.Funded) return;

        vm.prank(d.seller);
        holdr.markDelivered(id, "Delivered note");
    }

    function release(uint256 dealIdxSeed) public {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[dealIdxSeed % dealIds.length];
        Holdr.Deal memory d = holdr.getDeal(id);
        if (d.status != Holdr.Status.Funded && d.status != Holdr.Status.Delivered) return;

        vm.prank(d.buyer);
        holdr.release(id);
    }

    function openDispute(uint256 dealIdxSeed, bool callerBuyer) public {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[dealIdxSeed % dealIds.length];
        Holdr.Deal memory d = holdr.getDeal(id);
        if (d.status != Holdr.Status.Delivered) return;
        if (block.timestamp > d.reviewEnd) return;

        address caller = callerBuyer ? d.buyer : d.seller;
        vm.prank(caller);
        holdr.openDispute(id, "Dispute reason");
    }

    function resolve(uint256 dealIdxSeed, uint256 sellerShareSeed) public {
        if (dealIds.length == 0) return;
        uint256 id = dealIds[dealIdxSeed % dealIds.length];
        Holdr.Deal memory d = holdr.getDeal(id);
        if (d.status != Holdr.Status.Disputed) return;

        uint256 sellerAmount = bound(sellerShareSeed, 0, d.amount);
        vm.prank(d.arbiter);
        holdr.resolve(id, sellerAmount);
    }

    function withdraw(uint256 userIdxSeed) public {
        address user = users[userIdxSeed % users.length];
        uint256 bal = holdr.pendingBalance(user);
        if (bal == 0) return;

        vm.prank(user);
        holdr.withdraw();
        totalWithdrawn += bal;
    }

    function warpTime(uint256 secondsToWarp) public {
        uint256 jump = bound(secondsToWarp, 1 days, 30 days);
        vm.warp(block.timestamp + jump);
    }
}

contract HoldrInvariantTest is StdInvariant, Test {
    Holdr public holdr;
    HoldrHandler public handler;
    address[] public users;

    function setUp() public {
        holdr = new Holdr();

        users.push(address(0x1111));
        users.push(address(0x2222));
        users.push(address(0x3333));
        users.push(address(0x4444));

        handler = new HoldrHandler(holdr, users);

        targetContract(address(handler));
    }

    function invariant_solvencyAndAccounting() public view {
        uint256 contractBalance = address(holdr).balance;

        // Sum of active deals: Funded, Delivered, Disputed
        uint256 activeDealsSum = 0;
        uint256 totalDeals = holdr.dealCount();
        for (uint256 i = 1; i <= totalDeals; i++) {
            Holdr.Deal memory d = holdr.getDeal(i);
            if (
                d.status == Holdr.Status.Funded ||
                d.status == Holdr.Status.Delivered ||
                d.status == Holdr.Status.Disputed
            ) {
                activeDealsSum += d.amount;
            }
        }

        // Sum of all pending balances for all users in the system
        uint256 totalPendingBalances = 0;
        for (uint256 i = 0; i < users.length; i++) {
            totalPendingBalances += holdr.pendingBalance(users[i]);
        }

        assertEq(contractBalance, activeDealsSum + totalPendingBalances);
    }
}
