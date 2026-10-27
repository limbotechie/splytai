// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract SplytSession {
    struct Member {
        address addr;
        uint256 amountDue;
        bool paid;
    }

    struct Session {
        bytes32 id;
        address host;
        uint256 total;
        uint256 createdAt;
        uint256 expiresAt;
        bool active;
        Member[] members;
    }

    mapping(bytes32 => Session) public sessions;
    /// @dev 1-based index: 0 means "not a member", 1 means members[0], etc.
    mapping(bytes32 => mapping(address => uint256)) public memberIndex;
    IERC20 public immutable paymentToken;

    event SessionCreated(bytes32 indexed sessionId, address indexed host, uint256 total);
    event MemberPaid(bytes32 indexed sessionId, address indexed member, uint256 amount);
    event SessionClosed(bytes32 indexed sessionId, uint256 payoutAmount);
    event SessionCancelled(bytes32 indexed sessionId);

    error SessionNotFound();
    error SessionExpired();
    error SessionInactive();
    error MemberNotFound();
    error AlreadyPaid();
    error NotHost();
    error NotMember();
    error NotSettled();
    error TransferFailed();
    error InvalidSessionId();
    error InvalidToken();
    error InvalidExpiry();
    error LengthMismatch();
    error AmountMismatch();
    error SessionExists();
    error ZeroAddressMember();
    error DuplicateMember();

    constructor(address token) {
        // FIX #1: Use custom error instead of string revert for gas efficiency
        if (token == address(0)) revert InvalidToken();
        paymentToken = IERC20(token);
    }

    /// @notice Creates a split session and stores due amounts for each member.
    /// @param id Unique session identifier (must not be bytes32(0)).
    /// @param members Member wallet addresses (no duplicates, no zero addresses).
    /// @param amounts Corresponding amount due for each member in base units.
    /// @param total Total amount expected; must equal sum of amounts.
    /// @param expiresAt UNIX timestamp when the session expires (must be future).
    function createSession(
        bytes32 id,
        address[] calldata members,
        uint256[] calldata amounts,
        uint256 total,
        uint256 expiresAt
    ) external {
        // FIX #5: Reject bytes32(0) as a session ID — it is the sentinel for "not found"
        if (id == bytes32(0)) revert InvalidSessionId();
        if (members.length != amounts.length) revert LengthMismatch();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        Session storage session = sessions[id];
        if (session.id != bytes32(0)) revert SessionExists();

        uint256 sum;
        for (uint256 i = 0; i < members.length; i++) {
            // FIX #3: Reject zero-address members (they collide with the "not a member" sentinel)
            if (members[i] == address(0)) revert ZeroAddressMember();

            // FIX #4: Reject duplicate members — a duplicate makes the earlier
            // Member struct permanently unreachable, breaking _allPaid() forever.
            if (memberIndex[id][members[i]] != 0) revert DuplicateMember();

            session.members.push(Member({ addr: members[i], amountDue: amounts[i], paid: false }));
            memberIndex[id][members[i]] = i + 1; // 1-based
            sum += amounts[i];
        }

        if (sum != total) revert AmountMismatch();

        session.id = id;
        session.host = msg.sender;
        session.total = total;
        session.createdAt = block.timestamp;
        session.expiresAt = expiresAt;
        session.active = true;

        emit SessionCreated(id, msg.sender, total);
    }

    /// @notice Caller pays their own share for a session.
    ///         The caller must have pre-approved this contract for at least their amountDue.
    /// @param sessionId Session identifier.
    /// @dev FIX #2: Removed the `member` parameter entirely. The original signature
    ///      `markPaid(sessionId, member)` with `require(msg.sender != member)` was
    ///      circular — any caller could trivially satisfy it by passing their own address.
    ///      The correct pattern is: caller IS the member, no parameter needed.
    function markPaid(bytes32 sessionId) external {
        Session storage session = sessions[sessionId];
        if (session.id == bytes32(0)) revert SessionNotFound();
        if (block.timestamp > session.expiresAt) revert SessionExpired();
        if (!session.active) revert SessionInactive();

        uint256 idx = memberIndex[sessionId][msg.sender];
        if (idx == 0) revert NotMember();

        Member storage target = session.members[idx - 1];
        if (target.paid) revert AlreadyPaid();

        // Pull payment from caller — caller must have approved this contract first
        if (!paymentToken.transferFrom(msg.sender, address(this), target.amountDue)) {
            revert TransferFailed();
        }

        target.paid = true;
        emit MemberPaid(sessionId, msg.sender, target.amountDue);
    }

    /// @notice Closes an active session and releases collected funds to the host.
    ///         All members must have paid before this can be called.
    /// @param sessionId Session identifier to close.
    function closeSession(bytes32 sessionId) external {
        Session storage session = sessions[sessionId];
        _ensureHost(session);
        if (!session.active) revert SessionInactive();
        if (!_allPaid(session)) revert NotSettled();

        session.active = false;

        if (!paymentToken.transfer(session.host, session.total)) revert TransferFailed();

        emit SessionClosed(sessionId, session.total);
    }

    /// @notice FIX #6: Cancels an active session and refunds any members who already paid.
    ///         Without this, funds collected from early payers are permanently locked
    ///         if the session expires before all members pay.
    ///         Only the host can cancel; a cancelled session cannot be reopened.
    /// @param sessionId Session identifier to cancel.
    function cancelSession(bytes32 sessionId) external {
        Session storage session = sessions[sessionId];
        _ensureHost(session);
        if (!session.active) revert SessionInactive();

        session.active = false;

        for (uint256 i = 0; i < session.members.length; i++) {
            Member storage m = session.members[i];
            if (m.paid) {
                // Reset paid flag before external call (checks-effects-interactions)
                m.paid = false;
                if (!paymentToken.transfer(m.addr, m.amountDue)) revert TransferFailed();
            }
        }

        emit SessionCancelled(sessionId);
    }

    /// @notice Returns full session details including all members.
    /// @param sessionId Session identifier.
    /// @return Full Session struct in memory.
    /// @dev FIX #7 (note): Returning a struct with a dynamic Member[] array works
    ///      correctly under ABIv2 (default since Solidity 0.8). Consumers using
    ///      older ethers.js (<5) or ABIv1 encoding may fail to decode this. Ensure
    ///      your frontend uses ethers v5+ or viem, both of which handle this fine.
    function getSession(bytes32 sessionId) external view returns (Session memory) {
        Session memory session = sessions[sessionId];
        if (session.id == bytes32(0)) revert SessionNotFound();
        return session;
    }

    /// @notice Returns payment status for a specific member in a session.
    /// @param sessionId Session identifier.
    /// @param member Member wallet address.
    /// @return amountDue Amount owed by the member.
    /// @return paid Whether the member has paid.
    function getMemberStatus(
        bytes32 sessionId,
        address member
    ) external view returns (uint256 amountDue, bool paid) {
        Session storage session = sessions[sessionId];
        if (session.id == bytes32(0)) revert SessionNotFound();

        uint256 idx = memberIndex[sessionId][member];
        if (idx == 0) revert MemberNotFound();

        Member storage target = session.members[idx - 1];
        return (target.amountDue, target.paid);
    }

    /// @notice Returns true when every member in a session has paid.
    /// @param sessionId Session identifier.
    /// @return True if all members are marked paid.
    function allPaid(bytes32 sessionId) external view returns (bool) {
        Session storage session = sessions[sessionId];
        if (session.id == bytes32(0)) revert SessionNotFound();
        return _allPaid(session);
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _allPaid(Session storage session) internal view returns (bool) {
        for (uint256 i = 0; i < session.members.length; i++) {
            if (!session.members[i].paid) return false;
        }
        return true;
    }

    function _ensureHost(Session storage session) internal view {
        if (session.id == bytes32(0)) revert SessionNotFound();
        if (session.host != msg.sender) revert NotHost();
    }
}
