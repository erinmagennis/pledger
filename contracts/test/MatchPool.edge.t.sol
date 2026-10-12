// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdError} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {MockTIP20} from "./MatchPool.t.sol";

/// @dev MockTIP20 with failure toggles:
///      - silentMemo: transferWithMemo emits but moves nothing (a non-compliant token).
///      - blocked[to]: transferWithMemo / transfer to `to` reverts, like a TIP-403 policy block.
contract EdgeTIP20 is MockTIP20 {
    bool public silentMemo;
    mapping(address => bool) public blocked;

    function setSilentMemo(bool s) external {
        silentMemo = s;
    }

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function transfer(address to, uint256 a) public override returns (bool) {
        require(!blocked[to], "TIP403: blocked");
        return super.transfer(to, a);
    }

    function transferWithMemo(address to, uint256 a, bytes32 memo) public override {
        require(!blocked[to], "TIP403: blocked");
        if (silentMemo) {
            emit TransferWithMemo(msg.sender, to, a, memo);
            return;
        }
        super.transferWithMemo(to, a, memo);
    }
}

/// @dev MockTIP20 that, once armed, calls `target` with `data` (as itself) at the start of a chosen
///      transfer function, before any balance moves. Fires once per arming.
contract ReentrantTIP20 is MockTIP20 {
    uint8 public constant ON_TRANSFER = 1;
    uint8 public constant ON_TRANSFER_FROM = 2;
    uint8 public constant ON_MEMO = 3;

    address public target;
    bytes public data;
    uint8 public hookOn;
    bool public armed;
    bool public fired;
    bool public lastOk;
    bytes public lastRet;

    function arm(address t, bytes calldata d, uint8 on) external {
        target = t;
        data = d;
        hookOn = on;
        armed = true;
    }

    function selfApprove(address spender, uint256 a) external {
        allowance[address(this)][spender] = a;
    }

    function _hook(uint8 on) internal {
        if (!armed || hookOn != on) return;
        armed = false;
        fired = true;
        (lastOk, lastRet) = target.call(data);
    }

    function transfer(address to, uint256 a) public override returns (bool) {
        _hook(ON_TRANSFER);
        return super.transfer(to, a);
    }

    function transferFrom(address f, address to, uint256 a) public override returns (bool) {
        _hook(ON_TRANSFER_FROM);
        return super.transferFrom(f, to, a);
    }

    function transferWithMemo(address to, uint256 a, bytes32 memo) public override {
        _hook(ON_MEMO);
        super.transferWithMemo(to, a, memo);
    }
}

contract MatchPoolEdgeTest is Test {
    uint256 constant USD = 1e6;
    bytes32 constant MEMO = keccak256("memo");

    EdgeTIP20 token;
    MatchPool mp;
    address sponsor = makeAddr("sponsor");
    address recipient = makeAddr("recipient");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    address erin = makeAddr("erin");
    uint256 lockUntil;

    function setUp() public {
        token = new EdgeTIP20();
        lockUntil = block.timestamp + 30 days;
        mp = _pool(10_000, 100 * USD);
    }

    // ---------------------------------------------------------------- helpers
    function _pool(uint256 bps, uint256 cap) internal returns (MatchPool p) {
        p = new MatchPool(address(token), sponsor, recipient, bps, cap, lockUntil, "Edge Pool");
        address[7] memory all = [sponsor, recipient, alice, bob, carol, dave, erin];
        for (uint256 i; i < all.length; ++i) {
            if (token.balanceOf(all[i]) == 0) token.mint(all[i], 1_000_000 * USD);
            vm.prank(all[i]);
            token.approve(address(p), type(uint256).max);
        }
    }

    function _deposit(uint256 amt) internal {
        vm.prank(sponsor);
        mp.deposit(amt);
    }

    function _donate(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return mp.donate(amt, MEMO);
    }

    struct Snap {
        uint256 pool;
        uint256 totalDonated;
        uint256 totalMatched;
        uint256 donationCount;
        uint256 contractBal;
        uint256 recipientBal;
    }

    function _snap() internal view returns (Snap memory s) {
        s.pool = mp.pool();
        s.totalDonated = mp.totalDonated();
        s.totalMatched = mp.totalMatched();
        s.donationCount = mp.donationCount();
        s.contractBal = token.balanceOf(address(mp));
        s.recipientBal = token.balanceOf(recipient);
    }

    function _assertSame(Snap memory a, Snap memory b) internal pure {
        assertEq(a.pool, b.pool, "pool");
        assertEq(a.totalDonated, b.totalDonated, "totalDonated");
        assertEq(a.totalMatched, b.totalMatched, "totalMatched");
        assertEq(a.donationCount, b.donationCount, "donationCount");
        assertEq(a.contractBal, b.contractBal, "contract balance");
        assertEq(a.recipientBal, b.recipientBal, "recipient balance");
    }

    // ---------------------------------------------------------------- 1. sponsor donates to own pool
    function test_sponsorDonatesToOwnPool_isMatched() public {
        _deposit(500 * USD);
        uint256 sBefore = token.balanceOf(sponsor);
        uint256 m = _donate(sponsor, 40 * USD);
        assertEq(m, 40 * USD);
        assertEq(token.balanceOf(sponsor), sBefore - 40 * USD);
        assertEq(token.balanceOf(recipient), 1_000_000 * USD + 80 * USD);
        assertEq(mp.pool(), 460 * USD);
        assertEq(mp.matchedBy(sponsor), 40 * USD);
        assertEq(mp.totalDonated(), 40 * USD);
        assertEq(mp.totalMatched(), 40 * USD);
        assertEq(token.balanceOf(address(mp)), mp.pool());
    }

    // ---------------------------------------------------------------- 2. recipient donates
    /// Recipient donating to itself nets +match per donation; per-donor cap bounds the drain per address.
    /// NOTE: cap is per address, so a recipient using many addresses can drain the whole pool.
    function test_recipientDonates_netGainIsMatch_boundedByCap() public {
        _deposit(1_000 * USD);
        uint256 rBefore = token.balanceOf(recipient);
        _donate(recipient, 60 * USD); // m 60
        _donate(recipient, 60 * USD); // m 40 (cap 100)
        _donate(recipient, 60 * USD); // m 0
        assertEq(token.balanceOf(recipient) - rBefore, 100 * USD, "net gain == cap");
        assertEq(mp.matchedBy(recipient), 100 * USD);
        assertEq(mp.pool(), 900 * USD);
        assertEq(mp.totalDonated(), 180 * USD);

        // Same recipient via fresh addresses (sybil): each address gets its own cap.
        address[3] memory sybils = [makeAddr("s1"), makeAddr("s2"), makeAddr("s3")];
        for (uint256 i; i < 3; ++i) {
            token.mint(sybils[i], 100 * USD);
            vm.prank(sybils[i]);
            token.approve(address(mp), type(uint256).max);
            _donate(sybils[i], 100 * USD);
        }
        assertEq(mp.pool(), 600 * USD, "each sybil address drew a full cap");
    }

    // ---------------------------------------------------------------- 3. overflow
    function test_overflow_hugeAmount_revertsNoStateChange() public {
        _deposit(500 * USD);
        Snap memory s = _snap();
        vm.prank(alice);
        vm.expectRevert(stdError.arithmeticError);
        mp.donate(type(uint256).max, MEMO);
        _assertSame(s, _snap());
        assertEq(mp.matchedBy(alice), 0);

        vm.expectRevert(stdError.arithmeticError);
        mp.previewMatch(alice, type(uint256).max);
    }

    // ---------------------------------------------------------------- 4. insufficient balance / allowance
    function test_insufficientAllowance_reverts_stateUnchanged() public {
        _deposit(500 * USD);
        vm.prank(alice);
        token.approve(address(mp), 5 * USD);
        Snap memory s = _snap();
        vm.prank(alice);
        vm.expectRevert(bytes("allowance"));
        mp.donate(10 * USD, MEMO);
        _assertSame(s, _snap());
        assertEq(mp.matchedBy(alice), 0);
    }

    function test_insufficientBalance_reverts_stateUnchanged() public {
        _deposit(500 * USD);
        address poor = makeAddr("poor");
        token.mint(poor, 5 * USD);
        vm.prank(poor);
        token.approve(address(mp), type(uint256).max);
        Snap memory s = _snap();
        vm.prank(poor);
        vm.expectRevert(bytes("balance"));
        mp.donate(10 * USD, MEMO);
        _assertSame(s, _snap());
        assertEq(mp.matchedBy(poor), 0);
        assertEq(token.balanceOf(poor), 5 * USD);
    }

    // ---------------------------------------------------------------- 5. zero match config
    function test_zeroBpsAndZeroCap_forwardsWithZeroMatch() public {
        mp = _pool(0, 0);
        _deposit(500 * USD);
        uint256 rBefore = token.balanceOf(recipient);
        assertEq(_donate(alice, 40 * USD), 0);
        assertEq(token.balanceOf(recipient) - rBefore, 40 * USD);
        assertEq(mp.pool(), 500 * USD);

        // cap 0 alone (with 1:1) also means zero match
        mp = _pool(10_000, 0);
        _deposit(500 * USD);
        assertEq(_donate(alice, 40 * USD), 0);
        // bps 0 alone (with cap) also means zero match
        mp = _pool(0, 100 * USD);
        _deposit(500 * USD);
        assertEq(_donate(alice, 40 * USD), 0);
        assertEq(mp.totalMatched(), 0);
        assertEq(mp.totalDonated(), 40 * USD);
    }

    // ---------------------------------------------------------------- 6. 2:1 match
    function test_twoToOne_withCapAndPoolLimits() public {
        mp = _pool(20_000, 50 * USD);
        _deposit(120 * USD);
        assertEq(_donate(alice, 10 * USD), 20 * USD); // 2x
        assertEq(_donate(alice, 30 * USD), 30 * USD); // 60 wanted, cap room 30
        assertEq(_donate(alice, 1 * USD), 0); // cap used
        assertEq(_donate(bob, 40 * USD), 50 * USD); // 80 wanted, cap 50
        assertEq(_donate(carol, 40 * USD), 20 * USD); // 80 wanted, pool has 20
        assertEq(mp.pool(), 0);
        assertEq(_donate(dave, 5 * USD), 0); // pool empty
        assertEq(mp.totalMatched(), 120 * USD);
        assertEq(mp.totalDonated(), 126 * USD);
    }

    // ---------------------------------------------------------------- 7. exhaust to exactly 0
    function test_manyDonors_exhaustPoolExactly_thenZeroMatchStillForwarded() public {
        mp = _pool(10_000, 25 * USD);
        _deposit(100 * USD);
        address[4] memory ds = [alice, bob, carol, dave];
        for (uint256 i; i < 4; ++i) {
            assertEq(_donate(ds[i], 25 * USD), 25 * USD);
        }
        assertEq(mp.pool(), 0);
        assertEq(token.balanceOf(address(mp)), 0);
        uint256 rBefore = token.balanceOf(recipient);
        assertEq(_donate(erin, 10 * USD), 0);
        assertEq(token.balanceOf(recipient) - rBefore, 10 * USD);
        assertEq(mp.donationCount(), 5);
        assertEq(mp.totalMatched(), 100 * USD);
    }

    // ---------------------------------------------------------------- 8. withdraw twice
    function test_withdrawTwice_secondIsNoopNoRevert() public {
        _deposit(500 * USD);
        _donate(alice, 100 * USD);
        vm.warp(lockUntil + 1);
        uint256 sBefore = token.balanceOf(sponsor);
        vm.prank(sponsor);
        mp.withdrawRemainder();
        assertEq(token.balanceOf(sponsor) - sBefore, 400 * USD);

        uint256 sMid = token.balanceOf(sponsor);
        vm.recordLogs();
        vm.prank(sponsor);
        mp.withdrawRemainder(); // does not revert
        assertEq(token.balanceOf(sponsor), sMid, "no funds move");
        assertEq(token.balanceOf(address(mp)), 0);
        assertEq(mp.pool(), 0);
        // Only a Withdrawn(0) event, no token Transfer.
        assertEq(vm.getRecordedLogs().length, 1);
    }

    // ---------------------------------------------------------------- 9. multiple deposits
    function test_multipleDeposits_accumulate_andDepositAfterMatching() public {
        _deposit(100 * USD);
        _deposit(50 * USD);
        assertEq(mp.pool(), 150 * USD);
        assertEq(_donate(alice, 40 * USD), 40 * USD);
        assertEq(mp.pool(), 110 * USD);
        _deposit(25 * USD);
        assertEq(mp.pool(), 135 * USD);
        assertEq(token.balanceOf(address(mp)), 135 * USD);
        assertEq(mp.totalMatched() + mp.pool(), 175 * USD);
    }

    // ---------------------------------------------------------------- 10. recipient blocked
    function test_recipientBlocked_wholeDonateReverts() public {
        _deposit(500 * USD);
        token.setBlocked(recipient, true);
        Snap memory s = _snap();
        uint256 aBefore = token.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(bytes("TIP403: blocked"));
        mp.donate(40 * USD, MEMO);
        _assertSame(s, _snap());
        assertEq(token.balanceOf(alice), aBefore, "donor keeps funds");
        assertEq(mp.matchedBy(alice), 0);
    }

    /// Sponsor blocked at withdraw time: remainder stays in the contract, retry works once unblocked.
    function test_sponsorBlocked_withdrawRevertsThenRecovers() public {
        _deposit(500 * USD);
        vm.warp(lockUntil + 1);
        token.setBlocked(sponsor, true);
        vm.prank(sponsor);
        vm.expectRevert(bytes("TIP403: blocked"));
        mp.withdrawRemainder();
        assertEq(mp.pool(), 500 * USD);
        token.setBlocked(sponsor, false);
        vm.prank(sponsor);
        mp.withdrawRemainder();
        assertEq(mp.pool(), 0);
    }

    /// Token-trust assumption: if transferWithMemo returned without moving funds (non-TIP-20 behavior),
    /// MatchPool cannot tell. The donation is recorded and the funds strand in the contract, outside `pool`.
    function test_tokenTrust_silentMemo_strandsFunds() public {
        _deposit(500 * USD);
        token.setSilentMemo(true);
        uint256 rBefore = token.balanceOf(recipient);
        _donate(alice, 40 * USD);
        assertEq(token.balanceOf(recipient), rBefore, "recipient got nothing");
        assertEq(mp.totalDonated(), 40 * USD, "but donation recorded");
        assertEq(mp.pool(), 460 * USD);
        assertEq(token.balanceOf(address(mp)), 540 * USD, "80 stranded above pool");
        vm.warp(lockUntil + 1);
        vm.prank(sponsor);
        mp.withdrawRemainder();
        assertEq(token.balanceOf(address(mp)), 80 * USD, "stranded funds not recoverable");
    }

    // ---------------------------------------------------------------- 11. reentrancy
    function _reentrantSetup(address sponsor_)
        internal
        returns (ReentrantTIP20 rt, MatchPool p)
    {
        rt = new ReentrantTIP20();
        p = new MatchPool(address(rt), sponsor_, recipient, 10_000, 100 * USD, lockUntil, "Reentrant");
        rt.mint(sponsor_, 1_000 * USD);
        vm.prank(sponsor_);
        rt.approve(address(p), type(uint256).max);
        rt.mint(alice, 1_000 * USD);
        vm.prank(alice);
        rt.approve(address(p), type(uint256).max);
        // token itself acts as a second donor during reentry
        rt.mint(address(rt), 1_000 * USD);
        rt.selfApprove(address(p), type(uint256).max);
        vm.prank(sponsor_);
        p.deposit(150 * USD);
    }

    function _assertConsistent(ReentrantTIP20 rt, MatchPool p, uint256 deposited, uint256 withdrawn) internal view {
        assertEq(rt.balanceOf(address(p)), p.pool(), "balance == pool");
        assertEq(p.totalMatched() + p.pool(), deposited - withdrawn, "conservation");
        assertEq(rt.balanceOf(recipient), p.totalDonated() + p.totalMatched(), "recipient == donated+matched");
    }

    function test_reentrancy_donateDuringTransferFrom() public {
        (ReentrantTIP20 rt, MatchPool p) = _reentrantSetup(sponsor);
        rt.arm(address(p), abi.encodeCall(MatchPool.donate, (80 * USD, bytes32("inner"))), rt.ON_TRANSFER_FROM());
        vm.prank(alice);
        uint256 m = p.donate(100 * USD, MEMO);
        assertTrue(rt.fired() && rt.lastOk(), "inner donate ran");
        // outer computed its match first (100), inner sees pool 50 -> 50
        assertEq(m, 100 * USD);
        assertEq(p.matchedBy(address(rt)), 50 * USD);
        assertEq(p.pool(), 0);
        assertEq(p.donationCount(), 2);
        _assertConsistent(rt, p, 150 * USD, 0);
    }

    function test_reentrancy_donateDuringMemoTransfer() public {
        (ReentrantTIP20 rt, MatchPool p) = _reentrantSetup(sponsor);
        rt.arm(address(p), abi.encodeCall(MatchPool.donate, (80 * USD, bytes32("inner"))), rt.ON_MEMO());
        vm.prank(alice);
        p.donate(100 * USD, MEMO);
        assertTrue(rt.fired() && rt.lastOk(), "inner donate ran");
        assertEq(p.totalMatched(), 150 * USD, "pool never over-spent");
        assertEq(p.pool(), 0);
        _assertConsistent(rt, p, 150 * USD, 0);
    }

    function test_reentrancy_withdrawDuringWithdraw_noDoubleSpend() public {
        // sponsor is the token contract itself so the reentrant call passes the sponsor check
        ReentrantTIP20 rt = new ReentrantTIP20();
        address s = address(rt);
        MatchPool p = new MatchPool(address(rt), s, recipient, 10_000, 100 * USD, lockUntil, "R");
        rt.mint(s, 1_000 * USD);
        rt.selfApprove(address(p), type(uint256).max);
        vm.prank(s);
        p.deposit(150 * USD);

        vm.warp(lockUntil + 1);
        rt.arm(address(p), abi.encodeCall(MatchPool.withdrawRemainder, ()), rt.ON_TRANSFER());
        vm.prank(s);
        p.withdrawRemainder();
        assertTrue(rt.fired() && rt.lastOk(), "inner withdraw ran (and sent 0)");
        assertEq(rt.balanceOf(s), 1_000 * USD, "sponsor got exactly the 150 back, once");
        assertEq(rt.balanceOf(address(p)), 0);
        assertEq(p.pool(), 0);
    }

    function test_reentrancy_withdrawDuringLateDonate() public {
        ReentrantTIP20 rt = new ReentrantTIP20();
        address s = address(rt);
        MatchPool p = new MatchPool(address(rt), s, recipient, 10_000, 100 * USD, lockUntil, "R");
        rt.mint(s, 1_000 * USD);
        rt.selfApprove(address(p), type(uint256).max);
        vm.prank(s);
        p.deposit(150 * USD);
        rt.mint(alice, 100 * USD);
        vm.prank(alice);
        rt.approve(address(p), type(uint256).max);

        vm.warp(lockUntil + 1);
        rt.arm(address(p), abi.encodeCall(MatchPool.withdrawRemainder, ()), rt.ON_MEMO());
        vm.prank(alice);
        assertEq(p.donate(40 * USD, MEMO), 0);
        assertTrue(rt.fired() && rt.lastOk());
        assertEq(rt.balanceOf(s), 1_000 * USD, "sponsor got pool back");
        assertEq(rt.balanceOf(recipient), 40 * USD, "recipient got donation");
        assertEq(rt.balanceOf(address(p)), 0);
    }

    // ---------------------------------------------------------------- 12. rounding
    function test_rounding_dustGetsZeroMatchButCounted() public {
        mp = _pool(5_000, 100 * USD);
        _deposit(500 * USD);
        uint256 rBefore = token.balanceOf(recipient);
        assertEq(_donate(alice, 1), 0); // 0.5 base unit floors to 0
        assertEq(_donate(alice, 3), 1); // 1.5 floors to 1
        assertEq(mp.totalDonated(), 4);
        assertEq(mp.donationCount(), 2);
        assertEq(mp.totalMatched(), 1);
        assertEq(token.balanceOf(recipient) - rBefore, 5);
        assertEq(mp.pool(), 500 * USD - 1);
    }

    // ---------------------------------------------------------------- 13. lock boundary
    function test_lockBoundary_exact() public {
        _deposit(500 * USD);
        vm.warp(lockUntil);
        _deposit(10 * USD); // deposit still open at lockUntil
        assertEq(_donate(alice, 10 * USD), 10 * USD, "match at lockUntil");
        vm.prank(sponsor);
        vm.expectRevert(MatchPool.StillLocked.selector);
        mp.withdrawRemainder();

        vm.warp(lockUntil + 1);
        assertEq(_donate(alice, 10 * USD), 0, "no match after lockUntil");
        vm.prank(sponsor);
        vm.expectRevert(MatchPool.PledgeWindowClosed.selector);
        mp.deposit(1 * USD);
        uint256 sBefore = token.balanceOf(sponsor);
        vm.prank(sponsor);
        mp.withdrawRemainder();
        assertEq(token.balanceOf(sponsor) - sBefore, 500 * USD);
    }

    // ---------------------------------------------------------------- 14. sequence fuzz
    function testFuzz_sequences_conservation(uint256[24] calldata ops, uint16 bps, uint64 cap) public {
        mp = _pool(bound(bps, 0, 30_000), bound(cap, 0, 1_000 * USD));
        address[3] memory donors = [alice, bob, carol];
        uint256 deposited;
        uint256 withdrawn;

        for (uint256 i; i < ops.length; ++i) {
            uint256 op = ops[i];
            uint256 kind = op % 6;
            uint256 arg = op >> 8;
            if (kind == 0) {
                uint256 amt = bound(arg, 1, 10_000 * USD);
                vm.prank(sponsor);
                if (block.timestamp > lockUntil) {
                    vm.expectRevert(MatchPool.PledgeWindowClosed.selector);
                    mp.deposit(amt);
                } else {
                    mp.deposit(amt);
                    deposited += amt;
                }
            } else if (kind <= 3) {
                address d = donors[kind - 1];
                uint256 amt = bound(arg, 1, 5_000 * USD);
                uint256 expected = mp.previewMatch(d, amt);
                vm.prank(d);
                assertEq(mp.donate(amt, bytes32(i)), expected, "preview == actual");
            } else if (kind == 4) {
                vm.warp(block.timestamp + bound(arg, 0, 10 days));
            } else if (block.timestamp > lockUntil) {
                uint256 p = mp.pool();
                vm.prank(sponsor);
                mp.withdrawRemainder();
                withdrawn += p;
            }

            assertEq(token.balanceOf(address(mp)), mp.pool(), "balance == pool");
            assertEq(mp.totalMatched() + mp.pool(), deposited - withdrawn, "conservation");
            assertEq(token.balanceOf(recipient) - 1_000_000 * USD, mp.totalDonated() + mp.totalMatched(), "recipient");
            for (uint256 j; j < 3; ++j) {
                assertLe(mp.matchedBy(donors[j]), mp.perDonorCap(), "cap");
            }
        }
    }
}
