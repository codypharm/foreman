// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ForemanPro} from "../src/ForemanPro.sol";

/// Payments for Foreman Pro (docs/decisions/2026-11-26-pro-payments.md, decision 3): exactly 0.01 OKB
/// for one chat's code, a Paid event anyone can re-check, and only the owner can withdraw.
contract ForemanProTest is Test {
    ForemanPro internal pro;
    address internal owner = makeAddr("owner");
    address internal payer = makeAddr("payer");
    address internal friend = makeAddr("friend");

    /// A chat's code: 16 random bytes, padded to 32
    bytes32 internal constant CODE = bytes32(bytes16(0x9f1c2a7be04d5e6f8a0b1c2d3e4f5061));

    event Paid(bytes32 indexed code, address indexed payer, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    function setUp() public {
        pro = new ForemanPro(owner);
        vm.deal(payer, 1 ether);
        vm.deal(friend, 1 ether);
    }

    function test_theAmountIsOneHundredthOfAnOkb() public view {
        assertEq(pro.PRICE(), 0.01 ether);
    }

    function test_payingTheExactAmountRecordsTheCodeAndThePayer() public {
        vm.expectEmit(true, true, true, true, address(pro));
        emit Paid(CODE, payer, 0.01 ether);
        vm.prank(payer);
        pro.pay{value: 0.01 ether}(CODE);
        assertEq(address(pro).balance, 0.01 ether);
    }

    function test_anyoneCanPayForAnyCodeSoProCanBeAGift() public {
        vm.expectEmit(true, true, true, true, address(pro));
        emit Paid(CODE, friend, 0.01 ether);
        vm.prank(friend);
        pro.pay{value: 0.01 ether}(CODE);
    }

    function test_anyOtherAmountIsRefusedAndNothingIsKept() public {
        uint256[4] memory wrong = [uint256(0), 0.01 ether - 1, 0.01 ether + 1, 0.02 ether];
        for (uint256 i; i < wrong.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ForemanPro.WrongAmount.selector, wrong[i]));
            vm.prank(payer);
            pro.pay{value: wrong[i]}(CODE);
        }
        assertEq(address(pro).balance, 0);
        assertEq(payer.balance, 1 ether);
    }

    function test_aPaymentWithNoCodeIsRefused() public {
        vm.expectRevert(ForemanPro.NoCode.selector);
        vm.prank(payer);
        pro.pay{value: 0.01 ether}(bytes32(0));
    }

    function test_aPlainTransferIsRefusedSoNoPaymentArrivesWithoutACode() public {
        vm.prank(payer);
        (bool ok,) = address(pro).call{value: 0.01 ether}("");
        assertFalse(ok);
        assertEq(address(pro).balance, 0);
    }

    function test_onlyTheOwnerCanWithdrawAndEverythingGoesToTheOwner() public {
        vm.prank(payer);
        pro.pay{value: 0.01 ether}(CODE);
        vm.prank(friend);
        pro.pay{value: 0.01 ether}(CODE);

        vm.expectRevert(abi.encodeWithSelector(ForemanPro.NotOwner.selector, payer));
        vm.prank(payer);
        pro.withdraw();

        vm.expectEmit(true, true, true, true, address(pro));
        emit Withdrawn(owner, 0.02 ether);
        vm.prank(owner);
        pro.withdraw();
        assertEq(owner.balance, 0.02 ether);
        assertEq(address(pro).balance, 0);
    }

    function test_theOwnerCanNotBeTheZeroAddress() public {
        vm.expectRevert(ForemanPro.ZeroAddress.selector);
        new ForemanPro(address(0));
    }

    function test_theOwnerNeverChanges() public view {
        assertEq(pro.owner(), owner);
    }
}
