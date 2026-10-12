// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Tempo TIP-20 surface used by MatchPool (6-decimal stablecoins).
interface ITIP20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external;
}

/// @title MatchPool v1
/// @notice A sponsor locks a matching pool. Every donation is matched (up to a per-donor cap)
///         and forwarded, donation plus match, straight to a fixed recipient with a memo.
///         The sponsor can only take back what is left, and only after the lock ends.
contract MatchPool {
    // ---------------------------------------------------------------- errors
    error NotSponsor();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidLock();
    error StillLocked();
    error PledgeWindowClosed();
    error TransferFailed();

    // ---------------------------------------------------------------- events
    event Deposited(address indexed sponsor, uint256 amount);
    event Donated(address indexed donor, uint256 amount, uint256 matchAmount, bytes32 memo);
    event Withdrawn(uint256 amount);

    // ---------------------------------------------------------------- config
    ITIP20 public immutable token;
    address public immutable sponsor;
    address public immutable recipient;
    uint256 public immutable matchBps; // 10_000 = 1:1
    uint256 public immutable perDonorCap; // max total match per donor, token units
    uint256 public immutable lockUntil; // unix seconds
    string public name;

    uint256 internal constant BPS = 10_000;

    // ---------------------------------------------------------------- state
    uint256 public pool;
    uint256 public totalDonated;
    uint256 public totalMatched;
    uint256 public donationCount;
    mapping(address => uint256) public matchedBy;

    constructor(
        address token_,
        address sponsor_,
        address recipient_,
        uint256 matchBps_,
        uint256 perDonorCap_,
        uint256 lockUntil_,
        string memory name_
    ) {
        if (token_ == address(0) || sponsor_ == address(0) || recipient_ == address(0)) revert ZeroAddress();
        if (lockUntil_ <= block.timestamp) revert InvalidLock();
        token = ITIP20(token_);
        sponsor = sponsor_;
        recipient = recipient_;
        matchBps = matchBps_;
        perDonorCap = perDonorCap_;
        lockUntil = lockUntil_;
        name = name_;
    }

    /// @notice Sponsor funds the pool. Only allowed while the pledge window is open.
    function deposit(uint256 amount) external {
        if (msg.sender != sponsor) revert NotSponsor();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > lockUntil) revert PledgeWindowClosed();

        pool += amount;
        emit Deposited(msg.sender, amount);

        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /// @notice Donate `amount`; the matched total goes to the recipient with `memo`.
    function donate(uint256 amount, bytes32 memo) external returns (uint256 matchAmount) {
        if (amount == 0) revert ZeroAmount();

        matchAmount = previewMatch(msg.sender, amount);

        // effects
        if (matchAmount != 0) {
            pool -= matchAmount;
            matchedBy[msg.sender] += matchAmount;
            totalMatched += matchAmount;
        }
        totalDonated += amount;
        unchecked {
            ++donationCount;
        }
        emit Donated(msg.sender, amount, matchAmount, memo);

        // interactions
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        token.transferWithMemo(recipient, amount + matchAmount, memo);
    }

    /// @notice After the lock ends, the sponsor reclaims whatever was not used as match.
    ///         This is the only path by which pool funds can return to the sponsor.
    function withdrawRemainder() external {
        if (msg.sender != sponsor) revert NotSponsor();
        if (block.timestamp <= lockUntil) revert StillLocked();

        uint256 amount = pool;
        pool = 0;
        emit Withdrawn(amount);

        if (amount != 0 && !token.transfer(sponsor, amount)) revert TransferFailed();
    }

    // ---------------------------------------------------------------- views

    /// @notice Match `donor` would receive for a donation of `amount` right now.
    function previewMatch(address donor, uint256 amount) public view returns (uint256 m) {
        if (block.timestamp > lockUntil) return 0;
        m = (amount * matchBps) / BPS;
        if (m > pool) m = pool;
        uint256 used = matchedBy[donor];
        uint256 room = used >= perDonorCap ? 0 : perDonorCap - used;
        if (m > room) m = room;
    }

    function summary()
        external
        view
        returns (uint256 pool_, uint256 totalDonated_, uint256 totalMatched_, uint256 donationCount_, uint256 lockUntil_)
    {
        return (pool, totalDonated, totalMatched, donationCount, lockUntil);
    }
}
