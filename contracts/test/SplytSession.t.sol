// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SplytSession.sol";

contract MockERC20 {
    string public name = "Mock USDm";
    string public symbol = "mUSDm";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        require(allowance[from][msg.sender] >= amount, "INSUFFICIENT_ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SplytSessionTest is Test {
    SplytSession internal splyt;
    MockERC20 internal token;
    address internal host;
    address internal alice;
    address internal bob;
    bytes32 internal sessionId;

    function setUp() public {
        token = new MockERC20();
        host = makeAddr("host");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        sessionId = keccak256("session-1");

        token.mint(alice, 100);
        token.mint(bob, 100);
    }

    function _deployAndCreate() internal {
        vm.prank(host);
        splyt = new SplytSession(address(token));
        address[] memory members = new address[](2);
        members[0] = alice;
        members[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10;
        amounts[1] = 20;
        vm.prank(host);
        splyt.createSession(sessionId, members, amounts, 30, block.timestamp + 1 hours);
    }

    function _approveMember(address member, uint256 amount) internal {
        vm.prank(member);
        token.approve(address(splyt), amount);
    }

    function test_CreateSession_success() public {
        vm.prank(host);
        splyt = new SplytSession(address(token));

        address[] memory members = new address[](2);
        members[0] = alice;
        members[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10;
        amounts[1] = 20;

        vm.prank(host);
        splyt.createSession(sessionId, members, amounts, 30, block.timestamp + 1 hours);

        SplytSession.Session memory session = splyt.getSession(sessionId);
        assertEq(session.id, sessionId);
        assertEq(session.host, host);
        assertEq(session.total, 30);
        assertEq(session.members.length, 2);
    }

    function test_CreateSession_revertsMismatchedArrays() public {
        vm.prank(host);
        splyt = new SplytSession(address(token));
        address[] memory members = new address[](2);
        members[0] = alice;
        members[1] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10;

        vm.expectRevert(bytes("LENGTH_MISMATCH"));
        vm.prank(host);
        splyt.createSession(sessionId, members, amounts, 10, block.timestamp + 1 hours);
    }

    function test_CreateSession_revertsAmountMismatch() public {
        vm.prank(host);
        splyt = new SplytSession(address(token));
        address[] memory members = new address[](2);
        members[0] = alice;
        members[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10;
        amounts[1] = 20;

        vm.expectRevert(bytes("AMOUNT_MISMATCH"));
        vm.prank(host);
        splyt.createSession(sessionId, members, amounts, 100, block.timestamp + 1 hours);
    }

    function test_MarkPaid_success() public {
        _deployAndCreate();
        _approveMember(alice, 10);
        vm.prank(alice);
        splyt.markPaid(sessionId, alice);
        (, bool paid) = splyt.getMemberStatus(sessionId, alice);
        assertTrue(paid);
        assertEq(token.balanceOf(address(splyt)), 10);
    }

    function test_MarkPaid_revertsNotMember() public {
        _deployAndCreate();
        vm.expectRevert(SplytSession.NotMember.selector);
        splyt.markPaid(sessionId, alice);
    }

    function test_MarkPaid_revertsAlreadyPaid() public {
        _deployAndCreate();
        _approveMember(alice, 20);
        vm.prank(alice);
        splyt.markPaid(sessionId, alice);
        vm.expectRevert(SplytSession.AlreadyPaid.selector);
        vm.prank(alice);
        splyt.markPaid(sessionId, alice);
    }

    function test_MarkPaid_revertsWithoutAllowance() public {
        _deployAndCreate();
        vm.expectRevert(SplytSession.TransferFailed.selector);
        vm.prank(alice);
        splyt.markPaid(sessionId, alice);
    }

    function test_MarkPaid_revertsSessionExpired() public {
        _deployAndCreate();
        _approveMember(alice, 10);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(SplytSession.SessionExpired.selector);
        vm.prank(alice);
        splyt.markPaid(sessionId, alice);
    }

    function test_AllPaid_returnsTrueWhenAllPaid() public {
        _deployAndCreate();
        _approveMember(alice, 10);
        _approveMember(bob, 20);
        vm.prank(alice);
        splyt.markPaid(sessionId, alice);
        vm.prank(bob);
        splyt.markPaid(sessionId, bob);
        assertTrue(splyt.allPaid(sessionId));
    }

    function test_CloseSession_successAndPaysHost() public {
        _deployAndCreate();
        _approveMember(alice, 10);
        _approveMember(bob, 20);
        vm.prank(alice);
        splyt.markPaid(sessionId, alice);
        vm.prank(bob);
        splyt.markPaid(sessionId, bob);

        uint256 hostBalanceBefore = token.balanceOf(host);
        vm.prank(host);
        splyt.closeSession(sessionId);

        SplytSession.Session memory session = splyt.getSession(sessionId);
        assertFalse(session.active);
        assertEq(token.balanceOf(host), hostBalanceBefore + 30);
        assertEq(token.balanceOf(address(splyt)), 0);
    }

    function test_CloseSession_revertsNotSettled() public {
        _deployAndCreate();
        vm.expectRevert(SplytSession.NotSettled.selector);
        vm.prank(host);
        splyt.closeSession(sessionId);
    }

    function test_CloseSession_revertsNotHost() public {
        _deployAndCreate();
        vm.expectRevert(SplytSession.NotHost.selector);
        splyt.closeSession(sessionId);
    }
}
