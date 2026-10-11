// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface ITIP20 {
    function transfer(address to, uint256 a) external returns (bool);
    function transferFrom(address f, address to, uint256 a) external returns (bool);
    function transferWithMemo(address to, uint256 a, bytes32 memo) external;
}
contract MatchPool {
    ITIP20 public immutable token;
    address public immutable sponsor;
    address public immutable charity;
    uint256 public pool;
    constructor(address t, address s, address c) { token = ITIP20(t); sponsor = s; charity = c; }
    function deposit(uint256 a) external { require(msg.sender == sponsor); token.transferFrom(msg.sender, address(this), a); pool += a; }
    function donate(uint256 a, bytes32 memo) external {
        uint256 m = a > pool ? pool : a;
        pool -= m;
        token.transferFrom(msg.sender, address(this), a);
        token.transferWithMemo(charity, a + m, memo);
    }
    function refund() external { require(msg.sender == sponsor); uint256 p = pool; pool = 0; token.transfer(sponsor, p); }
}
