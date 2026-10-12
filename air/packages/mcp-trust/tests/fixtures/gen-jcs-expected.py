"""Generate RFC 8785 digests with the Python rfc8785 package for the TypeScript cross-check.

Run once from the repository root:
uv run --directory air/packages/mcp-trust --with rfc8785==0.1.4 python tests/fixtures/gen-jcs-expected.py tests/fixtures/jcs-expected.json

The file is written by the script itself, in UTF-8 with LF line ends, because a
shell redirect would write UTF-16 in Windows PowerShell 5.1.
"""
import hashlib
import json
import sys

import rfc8785

EURO = chr(0x20AC)
DALET = chr(0xFB33)
LINEAR_B = chr(0x10000)
O_DIAERESIS = chr(0xF6)
EM_DASH = chr(0x2014)
E_ACUTE = chr(0xE9)

VECTORS = {
    "numbers": {
        "numbers": [333333333.33333329, 1e30, 4.50, 2e-3, 0.000000000000000000000000001],
        "literals": [None, True, False],
    },
    "key-order-utf16": {
        EURO: "Euro Sign",
        DALET: "Hebrew Letter Dalet With Dagesh",
        "1": "One",
        LINEAR_B: "Linear B Syllable B008 A",
        O_DIAERESIS: "Latin Small Letter O With Diaeresis",
    },
    "tool": {
        "name": "browser_navigate",
        "description": "Navigate to a URL " + EM_DASH + " caf" + E_ACUTE + ".",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "default": "about:blank"},
                "timeout": {"type": "number", "default": 1.0},
            },
            "required": ["url"],
            "additionalProperties": False,
        },
    },
}

out = {}
for name, value in VECTORS.items():
    canonical = rfc8785.dumps(value)
    out[name] = {"value": value, "digest": "sha256:" + hashlib.sha256(canonical).hexdigest()}
if len(sys.argv) != 2:
    sys.exit("usage: gen-jcs-expected.py <output file>")
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as handle:
    handle.write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
