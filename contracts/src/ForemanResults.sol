// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A circuit's short verdict, readable by other contracts.
struct Verdict {
    uint8 kind; // 0 never published, 1 no earlier copy found, 2 copy, 3 too small to tell, 4 wrapper, 5 can't check
    uint8 canMine; // 1 mining, 2 can't mine, 3 stopped, 4 not started
    uint64 indexBlock; // the BNB Chain block the index was read up to
    bytes32 resultHash; // keccak256 of the full result in the Published event
}

/// @notice One result to publish: a BNB Chain circuit, its short verdict and its full result.
struct Entry {
    address processor;
    uint256 circuitId;
    uint8 kind;
    uint8 canMine;
    uint64 indexBlock;
    bytes result; // the data contract's Originality JSON
}

/// @title ForemanResults
/// @notice Foreman's originality results for BNB Chain circuits (docs/decisions/2026-11-21-results-contract.md).
///         Storage keeps each circuit's latest short verdict; the Published event carries the full result,
///         tied to the stored verdict by its hash. Not upgradeable.
contract ForemanResults {
    /// @notice Can replace the publisher, and nothing else. Never changes.
    address public immutable owner;
    /// @notice The only address that can publish.
    address public publisher;

    mapping(bytes32 key => Verdict) internal _verdicts;

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

    error NotPublisher(address caller);
    error NotOwner(address caller);
    error ZeroAddress();
    error EmptyBatch();
    /// @notice The entry at `index` has no processor, an unknown kind or can-mine state, no index block or no result.
    error BadEntry(uint256 index);

    constructor(address owner_, address publisher_) {
        if (owner_ == address(0) || publisher_ == address(0)) revert ZeroAddress();
        owner = owner_;
        publisher = publisher_;
        emit PublisherChanged(address(0), publisher_);
    }

    /// @notice Replace the publisher, for example after its key leaks. Owner only.
    function setPublisher(address next) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        if (next == address(0)) revert ZeroAddress();
        emit PublisherChanged(publisher, next);
        publisher = next;
    }

    /// @notice Publish a batch of results.
    function publish(Entry[] calldata entries) external {
        if (msg.sender != publisher) revert NotPublisher(msg.sender);
        if (entries.length == 0) revert EmptyBatch();
        for (uint256 i; i < entries.length; ++i) {
            Entry calldata e = entries[i];
            if (
                e.processor == address(0) || e.kind == 0 || e.kind > 5 || e.canMine == 0 || e.canMine > 4
                    || e.indexBlock == 0 || e.result.length == 0
            ) revert BadEntry(i);
            bytes32 key = keccak256(abi.encodePacked(e.processor, e.circuitId));
            bytes32 resultHash = keccak256(e.result);
            _verdicts[key] = Verdict(e.kind, e.canMine, e.indexBlock, resultHash);
            emit Published(key, e.processor, e.circuitId, e.kind, e.canMine, e.indexBlock, resultHash, e.result);
        }
    }

    /// @notice A circuit's latest short verdict; kind 0 if it was never published.
    function resultOf(address processor, uint256 circuitId) external view returns (Verdict memory) {
        return _verdicts[keccak256(abi.encodePacked(processor, circuitId))];
    }
}
