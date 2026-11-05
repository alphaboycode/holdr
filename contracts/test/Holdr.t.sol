// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Holdr} from "../src/Holdr.sol";

// Reentrant attacker
contract ReentrantAttacker {
    Holdr public holdr;
    uint256 public attackCount;

    constructor(Holdr _holdr) {
        holdr = _holdr;
    }

    function attack() external {
        holdr.withdraw();
    }

    receive() external payable {
        attackCount++;
        if (attackCount < 2) {
            holdr.withdraw();
        }
    }
}

// Rejector that reverts on receiving ETH
contract EthRejector {
    receive() external payable {
        revert("I refuse BOT");
    }
}

contract HoldrTest is Test {
    Holdr public holdr;

    address public buyer = address(0x101);
    address public seller = address(0x102);
    address public arbiter = address(0x103);
    address public stranger = address(0x999);

    event DealCreated(
        uint256 indexed id,
        address indexed buyer,
        address indexed seller,
        address arbiter,
        uint256 amount
    );
    event Delivered(uint256 indexed id, string note, uint64 reviewEnd);
    event Released(uint256 indexed id, uint256 amount);
    event Refunded(uint256 indexed id, uint256 amount);
    event DisputeOpened(uint256 indexed id, address indexed openedBy, string reason);
    event Resolved(uint256 indexed id, uint256 sellerAmount, uint256 buyerAmount);
    event Withdrawn(address indexed user, uint256 amount);

    function setUp() public {
        holdr = new Holdr();
        vm.deal(buyer, 100 ether);
        vm.deal(seller, 10 ether);
        vm.deal(arbiter, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    // Helper to create a standard deal
    function _createStandardDeal(uint256 amount) internal returns (uint256) {
        vm.prank(buyer);
        return holdr.createDeal{value: amount}(
            seller,
            arbiter,
            "Build website",
            "Build a responsive landing page with React",
            7, // 7 delivery days
            3  // 3 review days
        );
    }

    // ==========================================
    // 1. createDeal tests
    // ==========================================

    function test_createDeal_success() public {
        vm.prank(buyer);
        vm.expectEmit(true, true, true, false);
        emit DealCreated(1, buyer, seller, arbiter, 5 ether);

        uint256 id = holdr.createDeal{value: 5 ether}(
            seller,
            arbiter,
            "Logo design",
            "Vector SVG logo with light/dark variants",
            10,
            5
        );

        assertEq(id, 1);
        assertEq(holdr.dealCount(), 1);
        assertEq(address(holdr).balance, 5 ether);

        Holdr.Deal memory d = holdr.getDeal(1);
        assertEq(d.id, 1);
        assertEq(d.buyer, buyer);
        assertEq(d.seller, seller);
        assertEq(d.arbiter, arbiter);
        assertEq(d.amount, 5 ether);
        assertEq(d.title, "Logo design");
        assertEq(d.description, "Vector SVG logo with light/dark variants");
        assertEq(d.createdAt, block.timestamp);
        assertEq(d.deliveryDeadline, block.timestamp + 10 days);
        assertEq(d.reviewDays, 5);
        assertEq(uint8(d.status), uint8(Holdr.Status.Funded));
    }

    function test_createDeal_revertsOnZeroValue() public {
        vm.prank(buyer);
        vm.expectRevert(Holdr.ZeroAmount.selector);
        holdr.createDeal{value: 0}(
            seller,
            arbiter,
            "Logo",
            "Desc",
            5,
            3
        );
    }

    function test_createDeal_revertsOnZeroAddress() public {
        vm.startPrank(buyer);
        vm.expectRevert(Holdr.InvalidAddress.selector);
        holdr.createDeal{value: 1 ether}(
            address(0),
            arbiter,
            "Logo",
            "Desc",
            5,
            3
        );

        vm.expectRevert(Holdr.InvalidAddress.selector);
        holdr.createDeal{value: 1 ether}(
            seller,
            address(0),
            "Logo",
            "Desc",
            5,
            3
        );
        vm.stopPrank();
    }

    function test_createDeal_revertsOnDuplicateRoles() public {
        vm.startPrank(buyer);

        // Buyer == Seller
        vm.expectRevert(Holdr.DuplicateRole.selector);
        holdr.createDeal{value: 1 ether}(buyer, arbiter, "T", "D", 5, 3);

        // Buyer == Arbiter
        vm.expectRevert(Holdr.DuplicateRole.selector);
        holdr.createDeal{value: 1 ether}(seller, buyer, "T", "D", 5, 3);

        // Seller == Arbiter
        vm.expectRevert(Holdr.DuplicateRole.selector);
        holdr.createDeal{value: 1 ether}(seller, seller, "T", "D", 5, 3);

        vm.stopPrank();
    }

    function test_createDeal_revertsOnInvalidStringLengths() public {
        vm.startPrank(buyer);

        // Title empty (0 bytes)
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 100, 0));
        holdr.createDeal{value: 1 ether}(seller, arbiter, "", "Desc", 5, 3);

        // Title too long (>100 bytes)
        bytes memory longTitle = new bytes(101);
        for (uint256 i = 0; i < 101; i++) longTitle[i] = "a";
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 100, 101));
        holdr.createDeal{value: 1 ether}(seller, arbiter, string(longTitle), "Desc", 5, 3);

        // Description empty (0 bytes)
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 1000, 0));
        holdr.createDeal{value: 1 ether}(seller, arbiter, "Title", "", 5, 3);

        // Description too long (>1000 bytes)
        bytes memory longDesc = new bytes(1001);
        for (uint256 i = 0; i < 1001; i++) longDesc[i] = "b";
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 1000, 1001));
        holdr.createDeal{value: 1 ether}(seller, arbiter, "Title", string(longDesc), 5, 3);

        vm.stopPrank();
    }

    function test_createDeal_revertsOnInvalidDurations() public {
        vm.startPrank(buyer);

        // deliveryDays == 0
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDuration.selector, 1, 90, 0));
        holdr.createDeal{value: 1 ether}(seller, arbiter, "T", "D", 0, 3);

        // deliveryDays > 90
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDuration.selector, 1, 90, 91));
        holdr.createDeal{value: 1 ether}(seller, arbiter, "T", "D", 91, 3);

        // reviewDays == 0
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDuration.selector, 1, 14, 0));
        holdr.createDeal{value: 1 ether}(seller, arbiter, "T", "D", 10, 0);

        // reviewDays > 14
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDuration.selector, 1, 14, 15));
        holdr.createDeal{value: 1 ether}(seller, arbiter, "T", "D", 10, 15);

        vm.stopPrank();
    }

    // ==========================================
    // 2. markDelivered tests
    // ==========================================

    function test_markDelivered_success() public {
        uint256 id = _createStandardDeal(2 ether);

        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit Delivered(id, "Delivered via commit abc1234", uint64(block.timestamp + 3 days));
        holdr.markDelivered(id, "Delivered via commit abc1234");

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Delivered));
        assertEq(d.deliveredAt, block.timestamp);
        assertEq(d.reviewEnd, block.timestamp + 3 days);
        assertEq(d.deliveryNote, "Delivered via commit abc1234");
    }

    function test_markDelivered_revertsForNonSeller() public {
        uint256 id = _createStandardDeal(2 ether);

        vm.prank(buyer);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.markDelivered(id, "Delivered");

        vm.prank(stranger);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.markDelivered(id, "Delivered");
    }

    function test_markDelivered_revertsIfWrongStatus() public {
        uint256 id = _createStandardDeal(2 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "First delivery");

        // Already delivered
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Delivered));
        holdr.markDelivered(id, "Second delivery");
    }

    function test_markDelivered_sellerCanDeliverAfterDeadlineIfBuyerHasNotRefunded() public {
        uint256 id = _createStandardDeal(2 ether);

        // Fast forward 10 days (past 7 days deadline)
        vm.warp(block.timestamp + 10 days);

        vm.prank(seller);
        holdr.markDelivered(id, "Late delivery, apologies for delay");

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Delivered));
    }

    function test_markDelivered_revertsOnInvalidNoteLength() public {
        uint256 id = _createStandardDeal(2 ether);

        vm.startPrank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 500, 0));
        holdr.markDelivered(id, "");

        bytes memory longNote = new bytes(501);
        for (uint256 i = 0; i < 501; i++) longNote[i] = "z";
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 500, 501));
        holdr.markDelivered(id, string(longNote));
        vm.stopPrank();
    }

    // ==========================================
    // 3. release tests
    // ==========================================

    function test_release_fromFunded_success() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit Released(id, 3 ether);
        holdr.release(id);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Completed));
        assertEq(holdr.pendingBalance(seller), 3 ether);
    }

    function test_release_fromDelivered_success() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Ready");

        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit Released(id, 3 ether);
        holdr.release(id);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Completed));
        assertEq(holdr.pendingBalance(seller), 3 ether);
    }

    function test_release_revertsForNonBuyer() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(seller);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.release(id);

        vm.prank(stranger);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.release(id);
    }

    function test_release_revertsInWrongStatus() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(buyer);
        holdr.release(id);

        // Now completed, release again must revert
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.release(id);
    }

    // ==========================================
    // 4. claimAfterReview tests
    // ==========================================

    function test_claimAfterReview_success() public {
        uint256 id = _createStandardDeal(4 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Finished work");

        // Before review window ends (3 days)
        vm.warp(block.timestamp + 2 days);
        vm.prank(seller);
        vm.expectRevert(Holdr.ReviewWindowActive.selector);
        holdr.claimAfterReview(id);

        // Exactly at review end
        vm.warp(block.timestamp + 1 days); // total 3 days
        vm.prank(seller);
        vm.expectRevert(Holdr.ReviewWindowActive.selector);
        holdr.claimAfterReview(id);

        // Past review end
        vm.warp(block.timestamp + 1);
        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit Released(id, 4 ether);
        holdr.claimAfterReview(id);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Completed));
        assertEq(holdr.pendingBalance(seller), 4 ether);
    }

    function test_claimAfterReview_revertsForNonSeller() public {
        uint256 id = _createStandardDeal(4 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Finished work");

        vm.warp(block.timestamp + 4 days);

        vm.prank(buyer);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.claimAfterReview(id);
    }

    function test_claimAfterReview_revertsIfFunded() public {
        uint256 id = _createStandardDeal(4 ether);

        vm.warp(block.timestamp + 10 days);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Funded));
        holdr.claimAfterReview(id);
    }

    // ==========================================
    // 5. refundOverdue tests
    // ==========================================

    function test_refundOverdue_success() public {
        uint256 id = _createStandardDeal(5 ether);

        // Before deadline (7 days)
        vm.warp(block.timestamp + 6 days);
        vm.prank(buyer);
        vm.expectRevert(Holdr.DeliveryDeadlineNotPassed.selector);
        holdr.refundOverdue(id);

        // Exactly at deadline
        vm.warp(block.timestamp + 1 days);
        vm.prank(buyer);
        vm.expectRevert(Holdr.DeliveryDeadlineNotPassed.selector);
        holdr.refundOverdue(id);

        // Past deadline
        vm.warp(block.timestamp + 1);
        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit Refunded(id, 5 ether);
        holdr.refundOverdue(id);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Refunded));
        assertEq(holdr.pendingBalance(buyer), 5 ether);
    }

    function test_refundOverdue_revertsIfDelivered() public {
        uint256 id = _createStandardDeal(5 ether);

        vm.warp(block.timestamp + 8 days);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered late");

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Delivered));
        holdr.refundOverdue(id);
    }

    function test_refundOverdue_revertsForNonBuyer() public {
        uint256 id = _createStandardDeal(5 ether);
        vm.warp(block.timestamp + 8 days);

        vm.prank(seller);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.refundOverdue(id);
    }

    // ==========================================
    // 6. sellerRefund tests
    // ==========================================

    function test_sellerRefund_fromFunded_success() public {
        uint256 id = _createStandardDeal(2.5 ether);

        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit Refunded(id, 2.5 ether);
        holdr.sellerRefund(id);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Refunded));
        assertEq(holdr.pendingBalance(buyer), 2.5 ether);
    }

    function test_sellerRefund_fromDelivered_success() public {
        uint256 id = _createStandardDeal(2.5 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");

        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit Refunded(id, 2.5 ether);
        holdr.sellerRefund(id);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Refunded));
        assertEq(holdr.pendingBalance(buyer), 2.5 ether);
    }

    function test_sellerRefund_revertsForNonSeller() public {
        uint256 id = _createStandardDeal(2.5 ether);

        vm.prank(buyer);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.sellerRefund(id);

        vm.prank(stranger);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.sellerRefund(id);
    }

    // ==========================================
    // 7. openDispute tests
    // ==========================================

    function test_openDispute_byBuyer_success() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");

        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit DisputeOpened(id, buyer, "Incomplete specs");
        holdr.openDispute(id, "Incomplete specs");

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Disputed));
        assertEq(d.disputedAt, block.timestamp);
        assertEq(d.disputeReason, "Incomplete specs");
    }

    function test_openDispute_bySeller_success() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");

        vm.prank(seller);
        vm.expectEmit(true, true, false, true);
        emit DisputeOpened(id, seller, "Buyer requested scope change outside deal");
        holdr.openDispute(id, "Buyer requested scope change outside deal");

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Disputed));
        assertEq(d.disputeReason, "Buyer requested scope change outside deal");
    }

    function test_openDispute_revertsOutsideReviewWindow() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");

        // Review window is 3 days
        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(buyer);
        vm.expectRevert(Holdr.ReviewWindowClosed.selector);
        holdr.openDispute(id, "Too late");
    }

    function test_openDispute_revertsForStrangers() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");

        vm.prank(stranger);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.openDispute(id, "Stranger trolling");

        vm.prank(arbiter);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.openDispute(id, "Arbiter cannot open dispute");
    }

    function test_openDispute_revertsIfNotDelivered() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Funded));
        holdr.openDispute(id, "Seller not done");
    }

    function test_openDispute_revertsOnInvalidReasonLength() public {
        uint256 id = _createStandardDeal(3 ether);

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");

        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 500, 0));
        holdr.openDispute(id, "");

        bytes memory longReason = new bytes(501);
        for (uint256 i = 0; i < 501; i++) longReason[i] = "x";
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidStringLength.selector, 1, 500, 501));
        holdr.openDispute(id, string(longReason));
        vm.stopPrank();
    }

    // ==========================================
    // 8. resolve tests
    // ==========================================

    function test_resolve_success_fullSeller() public {
        uint256 id = _createStandardDeal(6 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.prank(arbiter);
        vm.expectEmit(true, false, false, true);
        emit Resolved(id, 6 ether, 0);
        holdr.resolve(id, 6 ether);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Resolved));
        assertEq(holdr.pendingBalance(seller), 6 ether);
        assertEq(holdr.pendingBalance(buyer), 0);
    }

    function test_resolve_success_fullBuyer() public {
        uint256 id = _createStandardDeal(6 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.prank(arbiter);
        vm.expectEmit(true, false, false, true);
        emit Resolved(id, 0, 6 ether);
        holdr.resolve(id, 0);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Resolved));
        assertEq(holdr.pendingBalance(seller), 0);
        assertEq(holdr.pendingBalance(buyer), 6 ether);
    }

    function test_resolve_success_split() public {
        uint256 id = _createStandardDeal(6 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.prank(arbiter);
        vm.expectEmit(true, false, false, true);
        emit Resolved(id, 4 ether, 2 ether);
        holdr.resolve(id, 4 ether);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Resolved));
        assertEq(holdr.pendingBalance(seller), 4 ether);
        assertEq(holdr.pendingBalance(buyer), 2 ether);
    }

    function test_resolve_revertsIfSellerAmountExceedsTotal() public {
        uint256 id = _createStandardDeal(6 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidSplitAmount.selector, 6.01 ether, 6 ether));
        holdr.resolve(id, 6.01 ether);
    }

    function test_resolve_revertsForNonArbiter() public {
        uint256 id = _createStandardDeal(6 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.prank(buyer);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.resolve(id, 3 ether);

        vm.prank(seller);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.resolve(id, 3 ether);
    }

    function test_resolve_revertsIfNotDisputed() public {
        uint256 id = _createStandardDeal(6 ether);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Funded));
        holdr.resolve(id, 3 ether);
    }

    // ==========================================
    // 9. splitAfterArbiterTimeout tests
    // ==========================================

    function test_splitAfterArbiterTimeout_evenAmount() public {
        uint256 id = _createStandardDeal(10 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        // Before 14 days
        vm.warp(block.timestamp + 14 days);
        vm.prank(buyer);
        vm.expectRevert(Holdr.ArbiterTimeoutNotPassed.selector);
        holdr.splitAfterArbiterTimeout(id);

        // Past 14 days
        vm.warp(block.timestamp + 1);
        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit Resolved(id, 5 ether, 5 ether);
        holdr.splitAfterArbiterTimeout(id);

        Holdr.Deal memory d = holdr.getDeal(id);
        assertEq(uint8(d.status), uint8(Holdr.Status.Resolved));
        assertEq(holdr.pendingBalance(seller), 5 ether);
        assertEq(holdr.pendingBalance(buyer), 5 ether);
    }

    function test_splitAfterArbiterTimeout_oddWeiGivesExtraToBuyer() public {
        uint256 oddAmount = 3 wei;
        vm.prank(buyer);
        uint256 id = holdr.createDeal{value: oddAmount}(
            seller,
            arbiter,
            "Odd wei task",
            "Desc",
            5,
            3
        );

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.warp(block.timestamp + 14 days + 1);
        vm.prank(buyer);
        // 3 / 2 = 1 wei to seller, 3 - 1 = 2 wei to buyer
        vm.expectEmit(true, false, false, true);
        emit Resolved(id, 1 wei, 2 wei);
        holdr.splitAfterArbiterTimeout(id);

        assertEq(holdr.pendingBalance(seller), 1 wei);
        assertEq(holdr.pendingBalance(buyer), 2 wei);
    }

    function test_splitAfterArbiterTimeout_revertsForNonParties() public {
        uint256 id = _createStandardDeal(10 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.warp(block.timestamp + 14 days + 1);

        // Arbiter is not buyer or seller
        vm.prank(arbiter);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.splitAfterArbiterTimeout(id);

        // Stranger
        vm.prank(stranger);
        vm.expectRevert(Holdr.Unauthorized.selector);
        holdr.splitAfterArbiterTimeout(id);
    }

    // ==========================================
    // 10. No double settlement tests
    // ==========================================

    function test_noDoubleSettlement_afterCompleted() public {
        uint256 id = _createStandardDeal(4 ether);
        vm.prank(buyer);
        holdr.release(id);

        // Try every mutating function on deal
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.markDelivered(id, "Delivered");

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.release(id);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.claimAfterReview(id);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.refundOverdue(id);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.sellerRefund(id);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.openDispute(id, "Reason");

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.resolve(id, 2 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Completed));
        holdr.splitAfterArbiterTimeout(id);
    }

    function test_noDoubleSettlement_afterRefunded() public {
        uint256 id = _createStandardDeal(4 ether);
        vm.prank(seller);
        holdr.sellerRefund(id);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.markDelivered(id, "Delivered");

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.release(id);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.claimAfterReview(id);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.refundOverdue(id);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.sellerRefund(id);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.openDispute(id, "Reason");

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.resolve(id, 2 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Refunded));
        holdr.splitAfterArbiterTimeout(id);
    }

    function test_noDoubleSettlement_afterResolved() public {
        uint256 id = _createStandardDeal(4 ether);
        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");
        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");
        vm.prank(arbiter);
        holdr.resolve(id, 2 ether);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.markDelivered(id, "Delivered");

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.release(id);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.claimAfterReview(id);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.refundOverdue(id);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.sellerRefund(id);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.openDispute(id, "Reason");

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.resolve(id, 2 ether);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Holdr.InvalidDealStatus.selector, Holdr.Status.Resolved));
        holdr.splitAfterArbiterTimeout(id);
    }

    // ==========================================
    // 11. withdraw & balance accumulation tests
    // ==========================================

    function test_withdraw_success_singleDeal() public {
        uint256 id = _createStandardDeal(5 ether);
        vm.prank(buyer);
        holdr.release(id);

        uint256 initialBal = seller.balance;

        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(seller, 5 ether);
        holdr.withdraw();

        assertEq(seller.balance, initialBal + 5 ether);
        assertEq(holdr.pendingBalance(seller), 0);

        // Immediate second withdraw must revert
        vm.prank(seller);
        vm.expectRevert(Holdr.NoPendingBalance.selector);
        holdr.withdraw();
    }

    function test_withdraw_accumulatesAcrossMultipleDeals() public {
        // Deal 1: 3 ether
        uint256 id1 = _createStandardDeal(3 ether);
        vm.prank(buyer);
        holdr.release(id1);

        // Deal 2: 7 ether
        vm.prank(buyer);
        uint256 id2 = holdr.createDeal{value: 7 ether}(
            seller,
            arbiter,
            "Second job",
            "Backend API",
            5,
            2
        );
        vm.prank(buyer);
        holdr.release(id2);

        assertEq(holdr.pendingBalance(seller), 10 ether);

        uint256 sellerBalBefore = seller.balance;
        vm.prank(seller);
        holdr.withdraw();

        assertEq(seller.balance, sellerBalBefore + 10 ether);
        assertEq(holdr.pendingBalance(seller), 0);
    }

    // ==========================================
    // 12. Reentrancy protection test
    // ==========================================

    function test_reentrancy_isBlocked() public {
        ReentrantAttacker attacker = new ReentrantAttacker(holdr);

        // Create deal where seller is attacker contract
        vm.prank(buyer);
        uint256 id = holdr.createDeal{value: 4 ether}(
            address(attacker),
            arbiter,
            "Attack deal",
            "Attempt reentrancy",
            5,
            2
        );

        // Buyer releases payment
        vm.prank(buyer);
        holdr.release(id);

        assertEq(holdr.pendingBalance(address(attacker)), 4 ether);

        // When attacker tries reentering during withdraw(), the second call must fail
        // ReentrancyGuardReentrantCall reverts in OZ 5.x
        vm.expectRevert();
        attacker.attack();
    }

    // ==========================================
    // 13. Rejector contract test
    // ==========================================

    function test_partyRejectingBOTOnlyHurtsItself() public {
        EthRejector rejector = new EthRejector();

        // Create deal where seller is the rejector
        vm.prank(buyer);
        uint256 id1 = holdr.createDeal{value: 2 ether}(
            address(rejector),
            arbiter,
            "Rejector deal",
            "Will reject transfer",
            5,
            2
        );

        // Create another deal with normal seller
        uint256 id2 = _createStandardDeal(5 ether);

        // Buyer releases both deals
        vm.prank(buyer);
        holdr.release(id1);
        vm.prank(buyer);
        holdr.release(id2);

        // Rejector's withdraw reverts TransferFailed
        vm.prank(address(rejector));
        vm.expectRevert(Holdr.TransferFailed.selector);
        holdr.withdraw();

        // Normal seller's withdraw succeeds without issue!
        uint256 sellerBalBefore = seller.balance;
        vm.prank(seller);
        holdr.withdraw();
        assertEq(seller.balance, sellerBalBefore + 5 ether);
    }

    // ==========================================
    // 14. Pagination tests
    // ==========================================

    function test_pagination_getDeals_and_getUserDealIds() public {
        // Create 3 deals
        vm.startPrank(buyer);
        holdr.createDeal{value: 1 ether}(seller, arbiter, "Deal 1", "Desc 1", 5, 2);
        holdr.createDeal{value: 2 ether}(seller, arbiter, "Deal 2", "Desc 2", 5, 2);
        holdr.createDeal{value: 3 ether}(seller, arbiter, "Deal 3", "Desc 3", 5, 2);
        vm.stopPrank();

        // getDeals newest first: Deal 3, Deal 2, Deal 1
        Holdr.Deal[] memory page1 = holdr.getDeals(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].id, 3);
        assertEq(page1[1].id, 2);

        Holdr.Deal[] memory page2 = holdr.getDeals(2, 2);
        assertEq(page2.length, 1);
        assertEq(page2[0].id, 1);

        // Offset edge cases
        Holdr.Deal[] memory emptyPage = holdr.getDeals(3, 10);
        assertEq(emptyPage.length, 0);

        Holdr.Deal[] memory beyondPage = holdr.getDeals(10, 5);
        assertEq(beyondPage.length, 0);

        // getUserDealIds newest first for buyer
        uint256[] memory buyerIds = holdr.getUserDealIds(buyer, 0, 10);
        assertEq(buyerIds.length, 3);
        assertEq(buyerIds[0], 3);
        assertEq(buyerIds[1], 2);
        assertEq(buyerIds[2], 1);

        // getUserDealIds for stranger (empty)
        uint256[] memory strangerIds = holdr.getUserDealIds(stranger, 0, 10);
        assertEq(strangerIds.length, 0);
    }

    // ==========================================
    // 15. Fuzz test
    // ==========================================

    function testFuzz_dealResolutionConservesFunds(
        uint96 amountRaw,
        uint96 sellerShareRaw
    ) public {
        vm.assume(amountRaw > 0 && amountRaw <= 50 ether);
        uint256 amount = uint256(amountRaw);
        uint256 sellerShare = uint256(sellerShareRaw) % (amount + 1);

        vm.deal(buyer, amount);
        vm.prank(buyer);
        uint256 id = holdr.createDeal{value: amount}(
            seller,
            arbiter,
            "Fuzz work",
            "Fuzz scope",
            10,
            5
        );

        vm.prank(seller);
        holdr.markDelivered(id, "Delivered");

        vm.prank(buyer);
        holdr.openDispute(id, "Dispute");

        vm.prank(arbiter);
        holdr.resolve(id, sellerShare);

        uint256 sellerPending = holdr.pendingBalance(seller);
        uint256 buyerPending = holdr.pendingBalance(buyer);

        assertEq(sellerPending + buyerPending, amount);
        assertEq(address(holdr).balance, amount);

        // Withdraw both
        uint256 sellerBalBefore = seller.balance;
        uint256 buyerBalBefore = buyer.balance;

        if (sellerPending > 0) {
            vm.prank(seller);
            holdr.withdraw();
            assertEq(seller.balance, sellerBalBefore + sellerPending);
        }

        if (buyerPending > 0) {
            vm.prank(buyer);
            holdr.withdraw();
            assertEq(buyer.balance, buyerBalBefore + buyerPending);
        }

        assertEq(address(holdr).balance, 0);
    }
}
