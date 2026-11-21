// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Entry, ForemanResults, Verdict} from "../src/ForemanResults.sol";

/// The results contract (docs/decisions/2026-11-21-results-contract.md): a short verdict per circuit
/// in storage, the full result in the log, tied by its hash.
contract ForemanResultsTest is Test {
    ForemanResults internal results;
    address internal owner = makeAddr("owner");
    address internal publisher = makeAddr("publisher");

    /// A real miner: circuit 17,663 on processor 0xb102…a14c, RIG voucher #16's miner. Its key is
    /// keccak256(abi.encodePacked(processor, circuitId)), as read from the mining contract.
    address internal constant PROCESSOR = 0xb1024b89886B9a34Aa4ff5F31C411D708b20a14C;
    uint256 internal constant CIRCUIT = 17_663;
    bytes32 internal constant MINER_KEY = 0x5b65ae8584f54c625d89c0000bc42c8a0a9c2dbdb8bbcc2f765ec76ce6aa13d3;

    bytes internal constant RESULT = bytes('{"scope":"miner","result":{"verdict":"no-earlier-copy"}}');

    event Published(
        bytes32 indexed key,
        address indexed processor,
        uint256 indexed circuitId,
        uint8 kind,
        uint8 canMine,
        uint64 indexBlock,
        bytes32 resultHash,
        bytes result
    );

    event PublisherChanged(address indexed previous, address indexed next);

    function setUp() public {
        results = new ForemanResults(owner, publisher);
    }

    function one(uint8 kind, uint8 canMine, uint64 indexBlock, bytes memory result)
        internal
        pure
        returns (Entry[] memory entries)
    {
        entries = new Entry[](1);
        entries[0] = Entry(PROCESSOR, CIRCUIT, kind, canMine, indexBlock, result);
    }

    function test_publishStoresTheShortVerdictAndLogsTheFullResultUnderTheMinerKey() public {
        vm.expectEmit(true, true, true, true, address(results));
        emit Published(MINER_KEY, PROCESSOR, CIRCUIT, 1, 1, 134_600_000, keccak256(RESULT), RESULT);
        vm.prank(publisher);
        results.publish(one(1, 1, 134_600_000, RESULT));

        Verdict memory v = results.resultOf(PROCESSOR, CIRCUIT);
        assertEq(v.kind, 1);
        assertEq(v.canMine, 1);
        assertEq(v.indexBlock, 134_600_000);
        assertEq(v.resultHash, keccak256(RESULT));
    }

    function test_onlyThePublisherCanPublish() public {
        address[2] memory others = [owner, makeAddr("anyone")];
        for (uint256 i; i < others.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ForemanResults.NotPublisher.selector, others[i]));
            vm.prank(others[i]);
            results.publish(one(1, 1, 134_600_000, RESULT));
        }
        assertEq(results.resultOf(PROCESSOR, CIRCUIT).kind, 0);
    }

    function test_theOwnerReplacesThePublisherAndTheOldOneCanNoLongerPublish() public {
        address next = makeAddr("next publisher");
        vm.expectEmit(true, true, false, false, address(results));
        emit PublisherChanged(publisher, next);
        vm.prank(owner);
        results.setPublisher(next);
        assertEq(results.publisher(), next);

        vm.expectRevert(abi.encodeWithSelector(ForemanResults.NotPublisher.selector, publisher));
        vm.prank(publisher);
        results.publish(one(1, 1, 134_600_000, RESULT));

        vm.prank(next);
        results.publish(one(1, 1, 134_600_000, RESULT));
        assertEq(results.resultOf(PROCESSOR, CIRCUIT).kind, 1);
    }

    function test_onlyTheOwnerCanReplaceThePublisher() public {
        address[2] memory others = [publisher, makeAddr("anyone")];
        for (uint256 i; i < others.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ForemanResults.NotOwner.selector, others[i]));
            vm.prank(others[i]);
            results.setPublisher(others[i]);
        }
        assertEq(results.publisher(), publisher);
    }

    function test_noOwnerOrPublisherIsTheZeroAddress() public {
        vm.expectRevert(ForemanResults.ZeroAddress.selector);
        new ForemanResults(address(0), publisher);
        vm.expectRevert(ForemanResults.ZeroAddress.selector);
        new ForemanResults(owner, address(0));
        vm.expectRevert(ForemanResults.ZeroAddress.selector);
        vm.prank(owner);
        results.setPublisher(address(0));
    }

    function test_aRepublishReplacesTheShortVerdictAndLogsTheNewResult() public {
        vm.startPrank(publisher);
        results.publish(one(1, 1, 134_600_000, RESULT));
        bytes memory stopped = bytes('{"scope":"miner","result":{"verdict":"no-earlier-copy"},"stopped":true}');
        vm.expectEmit(true, true, true, true, address(results));
        emit Published(MINER_KEY, PROCESSOR, CIRCUIT, 1, 3, 134_700_000, keccak256(stopped), stopped);
        results.publish(one(1, 3, 134_700_000, stopped));
        vm.stopPrank();

        Verdict memory v = results.resultOf(PROCESSOR, CIRCUIT);
        assertEq(v.canMine, 3);
        assertEq(v.indexBlock, 134_700_000);
        assertEq(v.resultHash, keccak256(stopped));
    }

    function test_aBatchPublishesEachCircuitUnderItsOwnKey() public {
        Entry[] memory entries = new Entry[](2);
        entries[0] = Entry(PROCESSOR, CIRCUIT, 1, 1, 134_600_000, RESULT);
        entries[1] = Entry(PROCESSOR, 12_903, 2, 1, 134_600_000, bytes('{"result":{"verdict":"copy"}}'));
        vm.prank(publisher);
        results.publish(entries);
        assertEq(results.resultOf(PROCESSOR, CIRCUIT).kind, 1);
        assertEq(results.resultOf(PROCESSOR, 12_903).kind, 2);
        assertEq(results.resultOf(PROCESSOR, 12_904).kind, 0);
    }

    function test_aBadEntryIsRefusedAndNothingInItsBatchIsPublished() public {
        Entry[] memory bad = new Entry[](7);
        bad[0] = Entry(PROCESSOR, CIRCUIT, 0, 1, 134_600_000, RESULT); // kind 0 means never published
        bad[1] = Entry(PROCESSOR, CIRCUIT, 6, 1, 134_600_000, RESULT); // no kind 6
        bad[2] = Entry(PROCESSOR, CIRCUIT, 1, 0, 134_600_000, RESULT); // every result has a can-mine state
        bad[3] = Entry(PROCESSOR, CIRCUIT, 1, 5, 134_600_000, RESULT); // no can-mine state 5
        bad[4] = Entry(PROCESSOR, CIRCUIT, 1, 1, 0, RESULT); // no index block
        bad[5] = Entry(PROCESSOR, CIRCUIT, 1, 1, 134_600_000, ""); // no full result
        bad[6] = Entry(address(0), CIRCUIT, 1, 1, 134_600_000, RESULT); // no processor
        for (uint256 i; i < bad.length; ++i) {
            Entry[] memory batch = new Entry[](2);
            batch[0] = Entry(PROCESSOR, 12_903, 1, 1, 134_600_000, RESULT);
            batch[1] = bad[i];
            vm.expectRevert(abi.encodeWithSelector(ForemanResults.BadEntry.selector, 1));
            vm.prank(publisher);
            results.publish(batch);
        }
        assertEq(results.resultOf(PROCESSOR, 12_903).kind, 0);
    }

    function test_anEmptyBatchIsRefused() public {
        vm.expectRevert(ForemanResults.EmptyBatch.selector);
        vm.prank(publisher);
        results.publish(new Entry[](0));
    }
}
