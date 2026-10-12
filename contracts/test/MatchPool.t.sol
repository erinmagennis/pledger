// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";

/// @dev Minimal TIP-20 stand-in: 6 decimals, bool-returning transfers, transferWithMemo emits a memo event.
contract MockTIP20 {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfers;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo);

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function setFail(bool f) external {
        failTransfers = f;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) public virtual returns (bool) {
        if (failTransfers) return false;
        _move(msg.sender, to, a);
        return true;
    }

    function transferFrom(address f, address to, uint256 a) public virtual returns (bool) {
        if (failTransfers) return false;
        uint256 al = allowance[f][msg.sender];
        require(al >= a, "allowance");
        allowance[f][msg.sender] = al - a;
        _move(f, to, a);
        return true;
    }

    function transferWithMemo(address to, uint256 a, bytes32 memo) public virtual {
        _move(msg.sender, to, a);
        emit TransferWithMemo(msg.sender, to, a, memo);
    }

    function _move(address f, address to, uint256 a) internal {
        require(balanceOf[f] >= a, "balance");
        balanceOf[f] -= a;
        balanceOf[to] += a;
        emit Transfer(f, to, a);
    }
}

contract MatchPoolTest is Test {
    event Deposited(address indexed sponsor, uint256 amount);
    event Donated(address indexed donor, uint256 amount, uint256 matchAmount, bytes32 memo);
    event Withdrawn(uint256 amount);
    event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo);

    uint256 constant USD = 1e6;

    MockTIP20 token;
    MatchPool mp;
    address sponsor = makeAddr("sponsor");
    address recipient = makeAddr("recipient");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 lockUntil;

    function setUp() public {
        token = new MockTIP20();
        lockUntil = block.timestamp + 30 days;
        mp = _pool(10_000, 100 * USD);
        _fund(sponsor, 1_000_000 * USD, address(mp));
        _fund(alice, 1_000_000 * USD, address(mp));
        _fund(bob, 1_000_000 * USD, address(mp));
    }

    // ---------------------------------------------------------------- helpers
    function _pool(uint256 bps, uint256 cap) internal returns (MatchPool) {
        return new MatchPool(address(token), sponsor, recipient, bps, cap, lockUntil, "Test Pool");
    }

    function _fund(address who, uint256 amt, address spender) internal {
        token.mint(who, amt);
        vm.prank(who);
        token.approve(spender, type(uint256).max);
    }

    function _deposit(MatchPool p, uint256 amt) internal {
        vm.prank(sponsor);
        token.approve(address(p), type(uint256).max);
        vm.prank(sponsor);
        p.deposit(amt);
    }

    function _donate(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return mp.donate(amt, keccak256("memo"));
    }

    // ---------------------------------------------------------------- constructor
    function test_constructor_rejectsBadConfig() public {
        vm.expectRevert(MatchPool.ZeroAddress.selector);
        new MatchPool(address(0), sponsor, recipient, 10_000, 1, lockUntil, "x");
        vm.expectRevert(MatchPool.InvalidLock.selector);
        new MatchPool(address(token), sponsor, recipient, 10_000, 1, block.timestamp, "x");
        assertEq(mp.name(), "Test Pool");
    }

    // ---------------------------------------------------------------- deposit
    function test_deposit_onlySponsor() public {
        vm.prank(alice);
        vm.expectRevert(MatchPool.NotSponsor.selector);
        mp.deposit(10 * USD);
    }

    function test_deposit_works() public {
        vm.prank(sponsor);
        token.approve(address(mp), type(uint256).max);
        vm.expectEmit(true, false, false, true, address(mp));
        emit Deposited(sponsor, 500 * USD);
        vm.prank(sponsor);
        mp.deposit(500 * USD);
        assertEq(mp.pool(), 500 * USD);
        assertEq(token.balanceOf(address(mp)), 500 * USD);
    }

    function test_deposit_zeroReverts() public {
        vm.prank(sponsor);
        vm.expectRevert(MatchPool.ZeroAmount.selector);
        mp.deposit(0);
    }

    function test_deposit_afterLockReverts() public {
        vm.warp(lockUntil + 1);
        vm.prank(sponsor);
        vm.expectRevert(MatchPool.PledgeWindowClosed.selector);
        mp.deposit(1 * USD);
    }

    function test_deposit_failedTransferReverts() public {
        token.setFail(true);
        vm.prank(sponsor);
        vm.expectRevert(MatchPool.TransferFailed.selector);
        mp.deposit(1 * USD);
    }

    // ---------------------------------------------------------------- match math
    function test_match_oneToOne() public {
        _deposit(mp, 500 * USD);
        uint256 m = _donate(alice, 40 * USD);
        assertEq(m, 40 * USD);
        assertEq(token.balanceOf(recipient), 80 * USD);
        assertEq(mp.pool(), 460 * USD);
        assertEq(mp.matchedBy(alice), 40 * USD);
    }

    function test_match_fiftyPercent() public {
        mp = _pool(5_000, 100 * USD);
        _fund(alice, 0, address(mp));
        _deposit(mp, 500 * USD);
        uint256 m = _donate(alice, 40 * USD);
        assertEq(m, 20 * USD);
        assertEq(token.balanceOf(recipient), 60 * USD);
        assertEq(mp.pool(), 480 * USD);
    }

    function test_match_perDonorCapAcrossDonations() public {
        _deposit(mp, 1_000 * USD);
        assertEq(_donate(alice, 60 * USD), 60 * USD);
        assertEq(_donate(alice, 60 * USD), 40 * USD); // capped at 100
        assertEq(_donate(alice, 60 * USD), 0); // cap used
        assertEq(mp.matchedBy(alice), 100 * USD);
        assertEq(_donate(bob, 60 * USD), 60 * USD); // cap is per donor
        assertEq(token.balanceOf(recipient), (180 + 100) * USD + (60 + 60) * USD);
    }

    function test_match_poolExhaustionPartial() public {
        _deposit(mp, 50 * USD);
        assertEq(_donate(alice, 30 * USD), 30 * USD);
        assertEq(_donate(bob, 30 * USD), 20 * USD); // only 20 left
        assertEq(mp.pool(), 0);
        assertEq(_donate(bob, 10 * USD), 0); // nothing left, donation still forwarded
        assertEq(token.balanceOf(recipient), 60 * USD + 50 * USD + 10 * USD);
    }

    function test_match_noneAfterLock() public {
        _deposit(mp, 500 * USD);
        vm.warp(lockUntil + 1);
        assertEq(_donate(alice, 40 * USD), 0);
        assertEq(token.balanceOf(recipient), 40 * USD);
        assertEq(mp.pool(), 500 * USD);
    }

    function test_match_stillAtExactLockTimestamp() public {
        _deposit(mp, 500 * USD);
        vm.warp(lockUntil);
        assertEq(_donate(alice, 10 * USD), 10 * USD);
    }

    function test_donate_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(MatchPool.ZeroAmount.selector);
        mp.donate(0, bytes32(0));
    }

    function test_donate_failedTransferFromReverts() public {
        _deposit(mp, 500 * USD);
        token.setFail(true);
        vm.prank(alice);
        vm.expectRevert(MatchPool.TransferFailed.selector);
        mp.donate(10 * USD, bytes32(0));
        assertEq(mp.pool(), 500 * USD); // state rolled back
    }

    // ---------------------------------------------------------------- memo
    function test_memo_forwarded() public {
        _deposit(mp, 500 * USD);
        bytes32 memo = keccak256("receipt-123");
        vm.expectEmit(true, false, false, true, address(mp));
        emit Donated(alice, 25 * USD, 25 * USD, memo);
        vm.expectEmit(true, true, true, true, address(token));
        emit TransferWithMemo(address(mp), recipient, 50 * USD, memo);
        vm.prank(alice);
        mp.donate(25 * USD, memo);
    }

    // ---------------------------------------------------------------- withdraw
    function test_withdraw_blockedBeforeLock() public {
        _deposit(mp, 500 * USD);
        vm.prank(sponsor);
        vm.expectRevert(MatchPool.StillLocked.selector);
        mp.withdrawRemainder();
        vm.warp(lockUntil);
        vm.prank(sponsor);
        vm.expectRevert(MatchPool.StillLocked.selector);
        mp.withdrawRemainder();
    }

    function test_withdraw_worksAfterLock() public {
        _deposit(mp, 500 * USD);
        _donate(alice, 100 * USD);
        uint256 before = token.balanceOf(sponsor);
        vm.warp(lockUntil + 1);
        vm.expectEmit(false, false, false, true, address(mp));
        emit Withdrawn(400 * USD);
        vm.prank(sponsor);
        mp.withdrawRemainder();
        assertEq(token.balanceOf(sponsor), before + 400 * USD);
        assertEq(mp.pool(), 0);
        assertEq(token.balanceOf(address(mp)), 0);
    }

    function test_withdraw_onlySponsor() public {
        _deposit(mp, 500 * USD);
        vm.warp(lockUntil + 1);
        vm.prank(alice);
        vm.expectRevert(MatchPool.NotSponsor.selector);
        mp.withdrawRemainder();
    }

    // ---------------------------------------------------------------- totals
    function test_totalsAndSummary() public {
        _deposit(mp, 150 * USD);
        _donate(alice, 80 * USD); // m 80
        _donate(alice, 50 * USD); // m 20 (cap)
        _donate(bob, 70 * USD); // m 50 (pool)
        (uint256 p, uint256 td, uint256 tm, uint256 dc, uint256 lu) = mp.summary();
        assertEq(p, 0);
        assertEq(td, 200 * USD);
        assertEq(tm, 150 * USD);
        assertEq(dc, 3);
        assertEq(lu, lockUntil);
        assertEq(mp.totalDonated(), td);
        assertEq(mp.totalMatched(), tm);
        assertEq(mp.donationCount(), dc);
        assertEq(token.balanceOf(recipient), td + tm);
    }

    // ---------------------------------------------------------------- fuzz
    function testFuzz_recipientGetsAmountPlusMatch(
        uint96 deposit_,
        uint64 a1,
        uint64 a2,
        uint64 a3,
        uint16 bps,
        uint64 cap,
        bool late
    ) public {
        mp = _pool(bound(bps, 0, 30_000), cap);
        _fund(alice, 0, address(mp));
        _fund(bob, 0, address(mp));
        uint256 dep = bound(deposit_, 1, 1_000_000 * USD);
        _deposit(mp, dep);
        if (late) vm.warp(lockUntil + 1);

        uint64[3] memory amts = [a1, a2, a3];
        address[3] memory who = [alice, bob, alice];
        uint256 sumMatch;
        for (uint256 i; i < 3; ++i) {
            uint256 amt = bound(amts[i], 1, 100_000 * USD);
            uint256 poolBefore = mp.pool();
            uint256 recBefore = token.balanceOf(recipient);
            vm.prank(who[i]);
            uint256 m = mp.donate(amt, bytes32(i));
            assertEq(token.balanceOf(recipient) - recBefore, amt + m, "recipient gets amount+match");
            assertLe(m, poolBefore, "match <= pool");
            assertEq(mp.pool(), poolBefore - m, "pool decremented by match");
            assertLe(mp.matchedBy(who[i]), cap, "per-donor cap");
            if (late) assertEq(m, 0, "no match after lock");
            sumMatch += m;
        }
        assertEq(mp.pool() + sumMatch, dep, "conservation");
        assertEq(token.balanceOf(address(mp)), mp.pool(), "contract holds exactly pool");
    }
}
