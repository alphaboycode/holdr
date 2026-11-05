// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Holdr
 * @notice Trust-minimized escrow for freelance payments on BOT Network.
 * @dev All payouts are pull-based using pendingBalance and withdraw().
 */
contract Holdr is ReentrancyGuard {
    // --- Data Types ---

    enum Status {
        Funded,
        Delivered,
        Disputed,
        Completed,
        Refunded,
        Resolved
    }

    struct Deal {
        uint256 id;
        address buyer;
        address seller;
        address arbiter;
        uint256 amount;
        string title;
        string description;
        string deliveryNote;
        string disputeReason;
        uint64 createdAt;
        uint64 deliveryDeadline;
        uint64 deliveredAt;
        uint64 reviewEnd;
        uint64 disputedAt;
        uint32 reviewDays;
        Status status;
    }

    // --- Constants ---

    uint256 public constant ARBITER_TIMEOUT = 14 days;

    // --- State Variables ---

    uint256 public dealCount;
    mapping(uint256 => Deal) private deals;
    mapping(address => uint256) public pendingBalance;
    mapping(address => uint256[]) private userDeals;

    // --- Events ---

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

    // --- Custom Errors ---

    error ZeroAmount();
    error InvalidAddress();
    error DuplicateRole();
    error InvalidStringLength(uint256 min, uint256 max, uint256 actual);
    error InvalidDuration(uint256 min, uint256 max, uint256 actual);
    error DealNotFound(uint256 id);
    error Unauthorized();
    error InvalidDealStatus(Status current);
    error DeliveryDeadlinePassed();
    error DeliveryDeadlineNotPassed();
    error ReviewWindowActive();
    error ReviewWindowClosed();
    error ArbiterTimeoutNotPassed();
    error InvalidSplitAmount(uint256 requested, uint256 max);
    error NoPendingBalance();
    error TransferFailed();

    // --- Modifiers ---

    modifier onlyValidDeal(uint256 id) {
        if (id == 0 || id > dealCount) revert DealNotFound(id);
        _;
    }

    // --- Functions ---

    /**
     * @notice Create and fund a new escrow deal.
     * @param seller The service provider / seller address.
     * @param arbiter The neutral arbiter agreed upon for disputes.
     * @param title Title of the freelance work (1-100 bytes).
     * @param description Scope of work / specifications (1-1000 bytes).
     * @param deliveryDays Days allowed for delivery (1-90).
     * @param reviewDays Days allowed for review after delivery (1-14).
     * @return id The identifier of the created deal.
     */
    function createDeal(
        address seller,
        address arbiter,
        string calldata title,
        string calldata description,
        uint32 deliveryDays,
        uint32 reviewDays
    ) external payable returns (uint256 id) {
        if (msg.value == 0) revert ZeroAmount();
        if (seller == address(0) || arbiter == address(0)) revert InvalidAddress();

        if (msg.sender == seller || msg.sender == arbiter || seller == arbiter) {
            revert DuplicateRole();
        }

        if (bytes(title).length < 1 || bytes(title).length > 100) {
            revert InvalidStringLength(1, 100, bytes(title).length);
        }
        if (bytes(description).length < 1 || bytes(description).length > 1000) {
            revert InvalidStringLength(1, 1000, bytes(description).length);
        }
        if (deliveryDays < 1 || deliveryDays > 90) {
            revert InvalidDuration(1, 90, deliveryDays);
        }
        if (reviewDays < 1 || reviewDays > 14) {
            revert InvalidDuration(1, 14, reviewDays);
        }

        id = ++dealCount;

        Deal storage d = deals[id];
        d.id = id;
        d.buyer = msg.sender;
        d.seller = seller;
        d.arbiter = arbiter;
        d.amount = msg.value;
        d.title = title;
        d.description = description;
        d.createdAt = uint64(block.timestamp);
        d.deliveryDeadline = uint64(block.timestamp + uint256(deliveryDays) * 1 days);
        d.reviewDays = reviewDays;
        d.status = Status.Funded;

        userDeals[msg.sender].push(id);
        userDeals[seller].push(id);
        userDeals[arbiter].push(id);

        emit DealCreated(id, msg.sender, seller, arbiter, msg.value);
    }

    /**
     * @notice Mark a funded deal as delivered.
     * @param id The deal identifier.
     * @param note Delivery note or reference (1-500 bytes).
     */
    function markDelivered(uint256 id, string calldata note) external onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.seller) revert Unauthorized();
        if (d.status != Status.Funded) revert InvalidDealStatus(d.status);

        uint256 noteLen = bytes(note).length;
        if (noteLen < 1 || noteLen > 500) {
            revert InvalidStringLength(1, 500, noteLen);
        }

        uint64 reviewEnd = uint64(block.timestamp + uint256(d.reviewDays) * 1 days);
        d.deliveredAt = uint64(block.timestamp);
        d.reviewEnd = reviewEnd;
        d.deliveryNote = note;
        d.status = Status.Delivered;

        emit Delivered(id, note, reviewEnd);
    }

    /**
     * @notice Buyer approves work and releases payment to seller.
     * @param id The deal identifier.
     */
    function release(uint256 id) external nonReentrant onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer) revert Unauthorized();
        if (d.status != Status.Funded && d.status != Status.Delivered) {
            revert InvalidDealStatus(d.status);
        }

        uint256 amount = d.amount;
        d.status = Status.Completed;
        pendingBalance[d.seller] += amount;

        emit Released(id, amount);
    }

    /**
     * @notice Seller claims payment after review window expires without dispute.
     * @param id The deal identifier.
     */
    function claimAfterReview(uint256 id) external nonReentrant onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.seller) revert Unauthorized();
        if (d.status != Status.Delivered) revert InvalidDealStatus(d.status);
        if (block.timestamp <= d.reviewEnd) revert ReviewWindowActive();

        uint256 amount = d.amount;
        d.status = Status.Completed;
        pendingBalance[d.seller] += amount;

        emit Released(id, amount);
    }

    /**
     * @notice Buyer claims refund if seller has not delivered before deadline.
     * @param id The deal identifier.
     */
    function refundOverdue(uint256 id) external nonReentrant onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer) revert Unauthorized();
        if (d.status != Status.Funded) revert InvalidDealStatus(d.status);
        if (block.timestamp <= d.deliveryDeadline) revert DeliveryDeadlineNotPassed();

        uint256 amount = d.amount;
        d.status = Status.Refunded;
        pendingBalance[d.buyer] += amount;

        emit Refunded(id, amount);
    }

    /**
     * @notice Seller voluntarily refunds buyer.
     * @param id The deal identifier.
     */
    function sellerRefund(uint256 id) external nonReentrant onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.seller) revert Unauthorized();
        if (d.status != Status.Funded && d.status != Status.Delivered) {
            revert InvalidDealStatus(d.status);
        }

        uint256 amount = d.amount;
        d.status = Status.Refunded;
        pendingBalance[d.buyer] += amount;

        emit Refunded(id, amount);
    }

    /**
     * @notice Open dispute while review window is active.
     * @param id The deal identifier.
     * @param reason Dispute reason (1-500 bytes).
     */
    function openDispute(uint256 id, string calldata reason) external onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer && msg.sender != d.seller) revert Unauthorized();
        if (d.status != Status.Delivered) revert InvalidDealStatus(d.status);
        if (block.timestamp > d.reviewEnd) revert ReviewWindowClosed();

        uint256 reasonLen = bytes(reason).length;
        if (reasonLen < 1 || reasonLen > 500) {
            revert InvalidStringLength(1, 500, reasonLen);
        }

        d.status = Status.Disputed;
        d.disputedAt = uint64(block.timestamp);
        d.disputeReason = reason;

        emit DisputeOpened(id, msg.sender, reason);
    }

    /**
     * @notice Arbiter resolves dispute, assigning funds between seller and buyer.
     * @param id The deal identifier.
     * @param sellerAmount Amount to allocate to seller (remaining to buyer).
     */
    function resolve(uint256 id, uint256 sellerAmount) external nonReentrant onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.arbiter) revert Unauthorized();
        if (d.status != Status.Disputed) revert InvalidDealStatus(d.status);
        if (sellerAmount > d.amount) revert InvalidSplitAmount(sellerAmount, d.amount);

        uint256 buyerAmount = d.amount - sellerAmount;
        d.status = Status.Resolved;

        if (sellerAmount > 0) {
            pendingBalance[d.seller] += sellerAmount;
        }
        if (buyerAmount > 0) {
            pendingBalance[d.buyer] += buyerAmount;
        }

        emit Resolved(id, sellerAmount, buyerAmount);
    }

    /**
     * @notice 50/50 split if arbiter is unresponsive for 14 days. Odd wei goes to buyer.
     * @param id The deal identifier.
     */
    function splitAfterArbiterTimeout(uint256 id) external nonReentrant onlyValidDeal(id) {
        Deal storage d = deals[id];
        if (msg.sender != d.buyer && msg.sender != d.seller) revert Unauthorized();
        if (d.status != Status.Disputed) revert InvalidDealStatus(d.status);
        if (block.timestamp <= uint256(d.disputedAt) + ARBITER_TIMEOUT) {
            revert ArbiterTimeoutNotPassed();
        }

        uint256 total = d.amount;
        uint256 sellerAmount = total / 2;
        uint256 buyerAmount = total - sellerAmount; // odd wei goes to buyer

        d.status = Status.Resolved;

        if (sellerAmount > 0) {
            pendingBalance[d.seller] += sellerAmount;
        }
        if (buyerAmount > 0) {
            pendingBalance[d.buyer] += buyerAmount;
        }

        emit Resolved(id, sellerAmount, buyerAmount);
    }

    /**
     * @notice Withdraw accumulated pending balance to caller.
     */
    function withdraw() external nonReentrant {
        uint256 balance = pendingBalance[msg.sender];
        if (balance == 0) revert NoPendingBalance();

        pendingBalance[msg.sender] = 0;
        emit Withdrawn(msg.sender, balance);

        (bool success, ) = msg.sender.call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    // --- Views ---

    /**
     * @notice Fetch complete details of a deal.
     * @param id The deal identifier.
     */
    function getDeal(uint256 id) external view onlyValidDeal(id) returns (Deal memory) {
        return deals[id];
    }

    /**
     * @notice Fetch paginated list of deals, newest first.
     * @param offset Number of latest deals to skip.
     * @param limit Maximum number of deals to return.
     */
    function getDeals(uint256 offset, uint256 limit) external view returns (Deal[] memory) {
        uint256 total = dealCount;
        if (total == 0 || offset >= total || limit == 0) {
            return new Deal[](0);
        }

        uint256 remaining = total - offset;
        uint256 count = limit < remaining ? limit : remaining;
        Deal[] memory result = new Deal[](count);

        uint256 startId = total - offset;
        for (uint256 i = 0; i < count; i++) {
            result[i] = deals[startId - i];
        }

        return result;
    }

    /**
     * @notice Fetch paginated deal IDs for a specific user, newest first.
     * @param user The user address (buyer, seller, or arbiter).
     * @param offset Number of latest deal IDs to skip.
     * @param limit Maximum number of deal IDs to return.
     */
    function getUserDealIds(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256[] storage ids = userDeals[user];
        uint256 total = ids.length;
        if (total == 0 || offset >= total || limit == 0) {
            return new uint256[](0);
        }

        uint256 remaining = total - offset;
        uint256 count = limit < remaining ? limit : remaining;
        uint256[] memory result = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            result[i] = ids[total - 1 - offset - i];
        }

        return result;
    }
}
