// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ForemanPro
/// @notice Payments for Foreman Pro (docs/decisions/2026-11-26-pro-payments.md). A payment is exactly
///         PRICE for one Telegram chat's code, which the bot gives that chat; the chat id never comes
///         here. Foreman counts 30 days of Pro from each Paid event, so every payment can be re-checked
///         from the log. Anyone may pay for any code. Only the owner can withdraw. Not upgradeable.
contract ForemanPro {
    /// @notice One payment: 0.01 of the chain's coin (test OKB on the X Layer testnet).
    uint256 public constant PRICE = 0.01 ether;
    /// @notice Receives every withdrawal. Never changes.
    address public immutable owner;

    event Paid(bytes32 indexed code, address indexed payer, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error WrongAmount(uint256 sent);
    error NoCode();
    error NotOwner(address caller);
    error ZeroAddress();
    error SendFailed();

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    /// @notice Pay for Pro for the chat whose code this is.
    function pay(bytes32 code) external payable {
        if (code == bytes32(0)) revert NoCode();
        if (msg.value != PRICE) revert WrongAmount(msg.value);
        emit Paid(code, msg.sender, msg.value);
    }

    /// @notice Send everything paid so far to the owner. Owner only.
    function withdraw() external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        uint256 amount = address(this).balance;
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert SendFailed();
        emit Withdrawn(owner, amount);
    }

    // No receive or fallback: a plain transfer, which would carry no code, is refused.
}
