# The API page shows a key's last 4 characters

- **Date:** 27 November 2026
- **Status:** Accepted
- **Decided by:** William, after seeing "This wallet has a key" with nothing to match against the key he had saved
- **Extends:** `2026-11-26-api-keys.md` (decision 5: a key is shown once and only its hash is kept) and `2026-11-26-self-serve-api-keys.md`. Neither is edited

## Context

A key is shown once, when it is made, and Foreman keeps only its SHA-256 hash. The API page's key band said "This wallet has a key · Made 26 Nov 2026" and offered "Sign to make a new key". An owner with a saved key couldn't tell whether it was the live one, and the button read as if no key existed yet.

## Decisions

### 1. Each key's last 4 characters are kept beside its hash

When a key is made, by signature or by hand, its last 4 characters are stored with it (migration `030-key-ending.sql`). That is 4 of the key's 32 random characters (24 random bytes, base64url): the other 28 still give 168 bits, far beyond guessing. The ending is never used to find a key; `/v1` still matches only the hash.

### 2. `ApiKeyStatus` carries it as `keyEnding`

`GET /keys/:wallet` gains `keyEnding`: the live key's last 4 characters, or null when the wallet has no key or its key was made before endings were kept. A missing field, or anything but 4 key characters, is refused, so a longer string (which could be the key) is never shown. This widens the data contract with William's agreement.

### 3. The band names the key, and its button says "Make another key"

The band reads "Made 26 Nov 2026 for 0x2ef2…49ef, ending in …a1b2". Its button reads "Make another key", so an owner remembers a key already exists; the text beside it still says the old key stops working and signing is free. After a key is shown, its link reads "Make another key (ends this one)".

### 4. Keys made before 27 Nov 2026 show no ending

Only their hash was kept, and the ending can't be worked out from it. The band says "before Foreman kept key endings" rather than guessing. Making another key gives one with an ending.

## Alternatives considered

- **Show the key's first characters.** Not chosen: every key starts with `fmn_`, so the first few say nothing.
- **More than 4 characters.** Not chosen: 4 is enough to tell two saved keys apart, and each extra character gives away more of the key.
- **Ask existing key holders to make another key now.** Not chosen: their keys work; the ending arrives with their next key.
